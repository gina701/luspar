const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const {MongoClient} = require('mongodb');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DB_FILE = path.join(DATA_DIR, 'luspa-data.json');
const OWNER_AUTH_FILE = path.join(DATA_DIR, 'owner-auth.json');
fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(BACKUP_DIR, {recursive:true});

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy: false}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:false, limit:'1mb'}));

const accounts = [
  {code:'1000',name:'Cash on Hand',type:'asset',subtype:'cash'},
  {code:'1010',name:'Bank Account',type:'asset',subtype:'cash'},
  {code:'1020',name:'Airtel Money',type:'asset',subtype:'cash'},
  {code:'1030',name:'TNM Mpamba',type:'asset',subtype:'cash'},
  {code:'1100',name:'Accounts Receivable',type:'asset',subtype:'receivable'},
  {code:'1200',name:'Barber Equipment',type:'asset',subtype:'fixed'},
  {code:'1210',name:'Accumulated Depreciation',type:'asset',subtype:'contra'},
  {code:'1300',name:'Supplies Inventory',type:'asset',subtype:'current'},
  {code:'2000',name:'Accounts Payable',type:'liability',subtype:'current'},
  {code:'2100',name:'Loans Payable',type:'liability',subtype:'longterm'},
  {code:'3000',name:"Owner's Capital",type:'equity',subtype:'capital'},
  {code:'3100',name:"Owner's Drawings",type:'equity',subtype:'drawings'},
  {code:'3200',name:'Retained Earnings / Opening Balance',type:'equity',subtype:'retained'},
  {code:'4000',name:'Haircut Services Revenue',type:'income',subtype:'service'},
  {code:'4010',name:'Other Services Revenue',type:'income',subtype:'service'},
  {code:'4020',name:'Product Sales Revenue',type:'income',subtype:'sales'},
  {code:'5000',name:'Supplies Expense',type:'expense',subtype:'operating'},
  {code:'5010',name:'Rent Expense',type:'expense',subtype:'operating'},
  {code:'5020',name:'Utilities Expense',type:'expense',subtype:'operating'},
  {code:'5030',name:'Wages and Commissions Expense',type:'expense',subtype:'operating'},
  {code:'5040',name:'Repairs and Maintenance Expense',type:'expense',subtype:'operating'},
  {code:'5050',name:'Marketing Expense',type:'expense',subtype:'operating'},
  {code:'5060',name:'Depreciation Expense',type:'expense',subtype:'operating'},
  {code:'5070',name:'Other Expense',type:'expense',subtype:'operating'}
];

function freshDB() {
  return {version:1, createdAt:new Date().toISOString(), accounts, services:[
    {id:crypto.randomUUID(),name:'Haircut',price:3000,active:true},
    {id:crypto.randomUUID(),name:'Beard trim',price:1500,active:true},
    {id:crypto.randomUUID(),name:'Shaving',price:1000,active:true}
  ], transactions:[], settings:{shopName:'Luspa Barbershop',currency:'MWK',language:'en',theme:'dark'}};
}
function loadLocalDB() {
  if (!fs.existsSync(DB_FILE)) { const db=freshDB(); saveDB(db); return db; }
  try {
    const db=JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
    if (!db.accounts || !db.transactions || !db.services) throw new Error('Missing database fields');
    // Add any new default accounts without deleting or changing user records.
    const seen = new Set(db.accounts.map(a=>a.code));
    for (const a of accounts) if (!seen.has(a.code)) db.accounts.push(a);
    return db;
  } catch (e) {
    const bad = path.join(BACKUP_DIR, `corrupt-${Date.now()}.json`);
    try { fs.copyFileSync(DB_FILE,bad); } catch {}
    throw new Error(`Could not read data file. A copy was attempted at ${bad}. Fix/restore the JSON before restarting. ${e.message}`);
  }
}
let db;
let persistedDB;
let mongoClient;
let mongoData;
let mongoAuth;
let passwordHash=process.env.ADMIN_PASSWORD_HASH || '';
function saveDB(next=db) {
  const temp = DB_FILE+'.tmp';
  fs.writeFileSync(temp, JSON.stringify(next,null,2), {mode:0o600});
  fs.renameSync(temp, DB_FILE);
}
async function persistDB(next=db) {
  try {
    if (mongoData) await mongoData.updateOne({_id:'primary'}, {$set:{data:next}}, {upsert:true});
    else saveDB(next);
  } catch(e) {
    if (persistedDB) db=structuredClone(persistedDB);
    const error=new Error('Could not persist application data.');
    error.cause=e;
    error.storageFailure=true;
    throw error;
  }
  db=next;
  persistedDB=structuredClone(next);
}
function backup(snapshot=db) {
  if (!snapshot) return;
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  fs.writeFileSync(path.join(BACKUP_DIR, `luspa-backup-${stamp}.json`), JSON.stringify(snapshot,null,2), {mode:0o600});
  const list=fs.readdirSync(BACKUP_DIR).filter(f=>f.startsWith('luspa-backup-')).sort();
  for (const f of list.slice(0, -30)) fs.rmSync(path.join(BACKUP_DIR,f),{force:true});
}

async function initializeStorage() {
  if (process.env.MONGODB_URI) {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const database=mongoClient.db();
    mongoData = database.collection('luspa_data');
    mongoAuth = database.collection('luspa_auth');
    const stored = await mongoData.findOne({_id:'primary'});
    if (stored) {
      db=stored.data;
      if (!db.accounts || !db.transactions || !db.services) throw new Error('MongoDB data document is missing required fields.');
      const seen=new Set(db.accounts.map(a=>a.code));
      for (const account of accounts) if (!seen.has(account.code)) db.accounts.push(account);
      await persistDB(db);
    } else {
      db=loadLocalDB();
      await persistDB(db);
    }
  } else {
    db=loadLocalDB();
  }
  await initializeOwnerPassword();
  persistedDB=structuredClone(db);
  backup();
  setInterval(()=>{try{backup();}catch(e){console.error('Backup failed:',e.message)}}, 24*60*60*1000).unref();
}

async function initializeOwnerPassword() {
  if (mongoAuth) {
    const stored=await mongoAuth.findOne({_id:'owner'});
    if (stored) {
      if (typeof stored.passwordHash!=='string') throw new Error('Stored owner authentication record is invalid.');
      passwordHash=stored.passwordHash;
    }
    else if (passwordHash) await mongoAuth.insertOne({_id:'owner',passwordHash});
  } else if (fs.existsSync(OWNER_AUTH_FILE)) {
    const stored=JSON.parse(fs.readFileSync(OWNER_AUTH_FILE,'utf8'));
    if (typeof stored.passwordHash!=='string') throw new Error('Stored owner authentication file is invalid.');
    passwordHash=stored.passwordHash || '';
  }
  if (passwordHash && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    throw new Error('Owner password hash is invalid. Set a valid ADMIN_PASSWORD_HASH or repair the stored owner authentication record.');
  }
}

async function persistOwnerPassword(nextHash) {
  if (mongoAuth) {
    await mongoAuth.updateOne({_id:'owner'},{$set:{passwordHash:nextHash}},{upsert:true});
  } else {
    const temp=OWNER_AUTH_FILE+'.tmp';
    fs.writeFileSync(temp,JSON.stringify({passwordHash:nextHash}),{mode:0o600});
    fs.renameSync(temp,OWNER_AUTH_FILE);
  }
  passwordHash=nextHash;
}

const sessionOptions = {
  name:'luspa.sid', secret:process.env.SESSION_SECRET || (process.env.NODE_ENV==='production' ? '' : 'local-development-only-change-this-secret'),
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}
};
if (process.env.MONGODB_URI) {
  sessionOptions.store = MongoStore.create({mongoUrl:process.env.MONGODB_URI, collectionName:'luspa_sessions', ttl:8*60*60});
}
if (process.env.NODE_ENV==='production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32)) {
  console.warn('WARNING: Set SESSION_SECRET to a random value of at least 32 characters.');
}
app.use(session(sessionOptions));
const loginLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:true,legacyHeaders:false});
const passwordChangeLimiter=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:true,legacyHeaders:false});
const adminUser=process.env.ADMIN_USERNAME || 'owner';
function requireAuth(req,res,next){ if(req.session && req.session.authenticated) return next(); return res.status(401).json({error:'Please sign in again.'}); }
app.post('/api/login',loginLimiter,async(req,res)=>{
  const username=String(req.body.username||'');
  const password=String(req.body.password||'');
  if(!passwordHash){return res.status(503).json({error:'Owner login is not configured. Set ADMIN_PASSWORD_HASH in your .env file.'});}
  const okUser=crypto.timingSafeEqual(Buffer.from(username.padEnd(128).slice(0,128)),Buffer.from(adminUser.padEnd(128).slice(0,128)));
  const okPass=await bcrypt.compare(password,passwordHash).catch(()=>false);
  if(!okUser||!okPass) return res.status(401).json({error:'Incorrect username or password.'});
  req.session.regenerate(err=>{
    if(err){console.error('Session creation failed:',err.message);return res.status(500).json({error:'Could not start secure session.'});}
    req.session.authenticated=true;
    req.session.user=adminUser;
    req.session.save(saveError=>{
      if(saveError){console.error('Session persistence failed:',saveError.message);return res.status(500).json({error:'Could not save your sign-in session. Check MongoDB session-store access and try again.'});}
      res.json({ok:true,user:adminUser});
    });
  });
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('luspa.sid');res.json({ok:true});}));
app.get('/api/session',(req,res)=>res.json({authenticated:!!req.session?.authenticated,user:req.session?.user||null}));
app.get('/api/health',(req,res)=>res.json({ok:true,app:'Luspa Barbershop',storage:mongoData?'mongodb':'json-file'}));

app.use('/api',requireAuth);
app.get('/api/data',(req,res)=>res.json(db));
app.get('/api/export',(req,res)=>{res.setHeader('Content-Disposition','attachment; filename="luspa-data-export.json"');res.json(db);});
app.post('/api/restore',async(req,res)=>{
  const incoming=req.body;
  if(!incoming || !Array.isArray(incoming.accounts)||!Array.isArray(incoming.transactions)||!Array.isArray(incoming.services)) return res.status(400).json({error:'Invalid Luspa backup file.'});
  if(incoming.transactions.some(t=>!Array.isArray(t.entries)||!t.entries.length||Math.abs(t.entries.reduce((s,e)=>s+Number(e.debit||0)-Number(e.credit||0),0))>0.01)) return res.status(400).json({error:'Backup contains an unbalanced journal entry.'});
  backup();
  // Restore replaces active data intentionally only after owner selects restore in the UI.
  const restored={...incoming,settings:{...db.settings,...incoming.settings}};
  try { await persistDB(restored); res.json({ok:true}); }
  catch(e) { console.error('Restore failed:',e.message); res.status(500).json({error:'Could not save the restored data.'}); }
});
function amount(n){const x=Number(n);if(!Number.isFinite(x)||x<0||x>1e12)throw new Error('Enter a valid non-negative amount.');return Math.round(x*100)/100;}
function getAccount(code){const a=db.accounts.find(x=>x.code===String(code));if(!a)throw new Error(`Unknown account: ${code}`);return a;}
async function postTransaction(input){
  const date=String(input.date||new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use a valid transaction date.');
  const entries=(input.entries||[]).map(e=>({accountCode:String(e.accountCode),debit:amount(e.debit||0),credit:amount(e.credit||0)}));
  if(entries.length<2)throw new Error('A journal entry needs at least two lines.');
  entries.forEach(e=>{getAccount(e.accountCode);if((e.debit>0)===(e.credit>0))throw new Error('Each journal line must have either a debit or a credit.');});
  const debits=entries.reduce((s,e)=>s+e.debit,0),credits=entries.reduce((s,e)=>s+e.credit,0);
  if(debits<=0||Math.abs(debits-credits)>0.01)throw new Error('Debits must equal credits.');
  const tx={id:crypto.randomUUID(),date,description:String(input.description||'Transaction').slice(0,180),category:String(input.category||'general'),reference:String(input.reference||'').slice(0,80),customer:String(input.customer||'').slice(0,100),paymentMethod:String(input.paymentMethod||''),createdAt:new Date().toISOString(),entries};
  db.transactions.push(tx); await persistDB(); return tx;
}
app.post('/api/transactions',async(req,res)=>{try{const tx=await postTransaction(req.body);res.status(201).json(tx);}catch(e){if(e.storageFailure){console.error('Transaction save failed:',e.cause?.message||e.message);return res.status(500).json({error:'Could not save the transaction.'});}res.status(400).json({error:e.message});}});
app.delete('/api/transactions/:id',(req,res)=>{res.status(403).json({error:'Posted accounting transactions cannot be deleted. Post a reversing/correcting journal entry to preserve the audit trail.'});});
app.post('/api/transactions/:id/reverse',async(req,res)=>{
  try{
    const original=db.transactions.find(t=>t.id===req.params.id);if(!original)return res.status(404).json({error:'Transaction not found.'});
    if(original.reversedBy)return res.status(400).json({error:'This transaction has already been reversed.'});
    const reversal=await postTransaction({date:new Date().toISOString().slice(0,10),description:`Reversal: ${original.description}`,category:'reversal',reference:original.id,entries:original.entries.map(e=>({accountCode:e.accountCode,debit:e.credit,credit:e.debit}))});
    original.reversedBy=reversal.id;await persistDB();res.json({ok:true,reversal});
  }catch(e){if(e.storageFailure){console.error('Transaction reversal failed:',e.cause?.message||e.message);return res.status(500).json({error:'Could not save the reversal.'});}res.status(400).json({error:e.message});}
});
app.post('/api/services',async(req,res)=>{
  const name=String(req.body.name||'').trim(), price=Number(req.body.price);
  if(!name||name.length>80||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Enter a service name and valid price.'});
  const service={id:crypto.randomUUID(),name,price:Math.round(price*100)/100,active:true};db.services.push(service);
  try { await persistDB(); res.status(201).json(service); }
  catch(e) { console.error('Service save failed:',e.message); res.status(500).json({error:'Could not save the service.'}); }
});
app.patch('/api/services/:id',async(req,res)=>{const s=db.services.find(x=>x.id===req.params.id);if(!s)return res.status(404).json({error:'Service not found.'});if(req.body.name!==undefined)s.name=String(req.body.name).slice(0,80);if(req.body.price!==undefined){const p=Number(req.body.price);if(!Number.isFinite(p)||p<0)return res.status(400).json({error:'Invalid price.'});s.price=p;}if(req.body.active!==undefined)s.active=!!req.body.active;try{await persistDB();res.json(s);}catch(e){console.error('Service update failed:',e.message);res.status(500).json({error:'Could not update the service.'});}});
app.patch('/api/settings',async(req,res)=>{db.settings={...db.settings,language:['en','ny'].includes(req.body.language)?req.body.language:db.settings.language,theme:['dark','light','system'].includes(req.body.theme)?req.body.theme:db.settings.theme,shopName:String(req.body.shopName||db.settings.shopName).slice(0,80)};try{await persistDB();res.json(db.settings);}catch(e){console.error('Settings save failed:',e.message);res.status(500).json({error:'Could not save settings.'});}});
app.post('/api/password',passwordChangeLimiter,async(req,res)=>{
  const currentPassword=String(req.body.currentPassword||'');
  const newPassword=String(req.body.newPassword||'');
  if(newPassword.length<12||newPassword.length>128) return res.status(400).json({error:'New password must be between 12 and 128 characters.'});
  const matches=await bcrypt.compare(currentPassword,passwordHash).catch(()=>false);
  if(!matches) return res.status(401).json({error:'Current password is incorrect.'});
  if(await bcrypt.compare(newPassword,passwordHash)) return res.status(400).json({error:'Choose a new password different from the current one.'});
  try {
    const nextHash=await bcrypt.hash(newPassword,12);
    await persistOwnerPassword(nextHash);
  } catch(e) {
    console.error('Owner password update failed:',e.message);
    return res.status(500).json({error:'Could not save the new password.'});
  }
  req.sessionStore.clear(clearError=>{
    if(clearError){console.error('Could not invalidate sessions after password change:',clearError.message);return res.status(500).json({error:'Password changed, but sessions could not be reset. Sign out and sign back in.'});}
    req.session.regenerate(regenerateError=>{
      if(regenerateError){console.error('Could not start session after password change:',regenerateError.message);return res.status(500).json({error:'Password changed. Please sign in again.'});}
      req.session.authenticated=true;
      req.session.user=adminUser;
      req.session.save(saveError=>{
        if(saveError){console.error('Could not save session after password change:',saveError.message);return res.status(500).json({error:'Password changed. Please sign in again.'});}
        res.json({ok:true});
      });
    });
  });
});
app.post('/api/backup',(req,res)=>{try{backup();res.json({ok:true,message:'Backup created.'});}catch(e){res.status(500).json({error:'Backup failed.'});}});
app.use('/api', (req,res)=>res.status(404).json({error:'API endpoint not found.'}));
app.use(express.static(path.join(ROOT,'public'),{extensions:['html'],maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
async function start() {
  await initializeStorage();
  app.listen(PORT,()=>console.log(`Luspa Barbershop is running at http://localhost:${PORT}`));
}
start().catch(e=>{
  console.error('Could not initialize storage:',e.message);
  if (mongoClient) mongoClient.close().catch(closeError=>console.error('Could not close MongoDB connection:',closeError.message));
  process.exitCode=1;
});
