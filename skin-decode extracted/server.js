// Skin Decode server: serves the website and a /api/chat endpoint backed by Claude.
// Zero dependencies. Needs Node 18+. Run: ANTHROPIC_API_KEY=sk-ant-... node server.js
const http=require("http"),fs=require("fs"),path=require("path");
try{fs.readFileSync(path.join(__dirname,".env"),"utf8").split("\n").forEach(l=>{const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,"")})}catch{}
const PORT=process.env.PORT||3000,KEY=process.env.ANTHROPIC_API_KEY,MODEL=process.env.CLAUDE_MODEL||"claude-sonnet-5-5";

const SYSTEM=`You are Skin AI, the skincare assistant on the Skin Decode website. Tagline: "Because your skin deserves better."
You help customers with: (1) product suggestions, (2) morning or night routines, (3) information about any skincare product or ingredient.
Style: warm, clear, concise (under 180 words unless a routine is requested). Use short bullet lists with "- ". Bold key names with **double asterisks**. Ask one short follow-up question when you lack skin type or concern.
Brands: recommend real Korean and Indian skincare brands when relevant, matched to the customer's skin type, concern and budget. Examples you know well:
Korean: COSRX (Low pH Good Morning Gel Cleanser, BHA Blackhead Power Liquid, Advanced Snail 96 Mucin Power Essence), Beauty of Joseon (Relief Sun Rice + Probiotics SPF50+, Glow Serum Propolis + Niacinamide), Anua (Heartleaf 77% Soothing Toner), Skin1004 (Madagascar Centella Ampoule), Laneige (Water Bank Blue Hyaluronic Cream), Isntree (Hyaluronic Acid Toner), Round Lab (1025 Dokdo Toner), Some By Mi (AHA BHA PHA 30 Days Miracle Toner), Innisfree.
Indian: Minimalist (10% Niacinamide Serum, 2% Salicylic Acid Serum, 10% Vitamin C Serum, 0.3% Retinol Serum, Light Fluid SPF 50), The Derma Co (2% Salicylic Acid Face Wash, 1% Hyaluronic Sunscreen Aqua Gel SPF 50), Dot & Key, Plum, Re'equil, Dr. Sheth's, Foxtale, Aqualogica.
When the customer names a product type (cleanser, toner, serum, essence, moisturiser, sunscreen), give 2 to 3 picks of that type, mixing Korean and Indian brands, and say why each suits their skin. Rules: never invent products, prices or claims; if unsure a product exists, name the ingredient type instead and say to check the label. Say lineups and formulas change, so check the ingredient list. Recommend patch testing, sunscreen every morning, and introducing one new active at a time. Warn about retinol and strong acids in pregnancy. For severe, painful, spreading or persistent skin problems, advise seeing a dermatologist. You are not a doctor; never diagnose. Stay on skincare topics; politely redirect anything else.`;

const hits=new Map();
function limited(ip){const now=Date.now(),a=(hits.get(ip)||[]).filter(t=>now-t<60000);a.push(now);hits.set(ip,a);return a.length>20}
const send=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json"});res.end(JSON.stringify(obj))};
const clip=(v,n)=>String(v==null?"":v).replace(/[\r\n]+/g," ").slice(0,n);

async function chat(req,res){
  if(!KEY)return send(res,503,{error:"no_key"});
  if(limited(req.socket.remoteAddress))return send(res,429,{error:"slow_down"});
  let body="";for await(const c of req){body+=c;if(body.length>20000)return send(res,413,{error:"too_large"})}
  let data;try{data=JSON.parse(body)}catch{return send(res,400,{error:"bad_json"})}
  let msgs=(Array.isArray(data.messages)?data.messages:[]).filter(m=>m&&["user","assistant"].includes(m.role)&&typeof m.content==="string"&&m.content.trim()).slice(-12).map(m=>({role:m.role,content:m.content.slice(0,1500)}));
  while(msgs.length&&msgs[0].role!=="user")msgs.shift();
  if(!msgs.length||msgs[msgs.length-1].role!=="user")return send(res,400,{error:"no_message"});
  const p=data.profile&&typeof data.profile==="object"?data.profile:null;
  const system=SYSTEM+(p?`\nCustomer's saved Skin Scan: skin type ${clip(p.type,30)}, main concern ${clip(p.concern,30)}, sensitivity ${clip(p.sens,30)}. Use it unless they say otherwise.`:"");
  try{
    const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:MODEL,max_tokens:800,system,messages:msgs})});
    const j=await r.json();
    if(!r.ok){console.error("Anthropic error",r.status,j&&j.error&&j.error.message);return send(res,502,{error:"upstream"})}
    send(res,200,{reply:(j.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim()});
  }catch(e){console.error(e.message);send(res,502,{error:"upstream"})}
}

const TYPES={".html":"text/html",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon"};
function serve(req,res){
  let p=decodeURIComponent(req.url.split("?")[0]);if(p==="/")p="/index.html";
  const f=path.join(__dirname,path.normalize(p)),ext=path.extname(f).toLowerCase();
  const ok=f.startsWith(__dirname+path.sep)&&(TYPES[ext]||path.basename(f)==="script.js");
  if(!ok)return send(res,404,{error:"not_found"});
  fs.readFile(f,(e,buf)=>{if(e)return send(res,404,{error:"not_found"});res.writeHead(200,{"Content-Type":TYPES[ext]||"text/javascript"});res.end(buf)});
}
http.createServer((req,res)=>{
  if(req.method==="POST"&&req.url==="/api/chat")return chat(req,res);
  if(req.method==="GET"&&req.url==="/api/status")return send(res,200,{ai:!!KEY});
  if(req.method==="GET")return serve(req,res);
  send(res,405,{error:"method"});
}).listen(PORT,()=>console.log(`Skin Decode on http://localhost:${PORT}  |  AI: ${KEY?"on ("+MODEL+")":"OFF, set ANTHROPIC_API_KEY"}`));
