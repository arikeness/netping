import { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, ScatterChart, Scatter, ZAxis } from "recharts";

// ══════════════════════════════════════════════════════════════════════════════
// DEFAULTS & HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const DEFAULT_GROUPS = [
  { id:"switches", name:"Switchler", icon:"⬡", hosts:[
    { id:"sw1", label:"SW-Core-01", ip:"192.168.1.1" },
    { id:"sw2", label:"SW-Core-02", ip:"192.168.1.2" },
    { id:"sw3", label:"SW-Access-01", ip:"192.168.1.10" },
  ]},
  { id:"servers", name:"Sunucular", icon:"▣", hosts:[
    { id:"srv1", label:"Web-Server-01", ip:"10.0.0.10" },
    { id:"srv2", label:"DB-Server-01",  ip:"10.0.0.20" },
    { id:"srv3", label:"Backup-Server", ip:"10.0.0.30" },
  ]},
];

const COMMON_PORTS = [
  {port:21,svc:"FTP"},{port:22,svc:"SSH"},{port:23,svc:"Telnet"},
  {port:25,svc:"SMTP"},{port:53,svc:"DNS"},{port:80,svc:"HTTP"},
  {port:110,svc:"POP3"},{port:143,svc:"IMAP"},{port:443,svc:"HTTPS"},
  {port:445,svc:"SMB"},{port:3306,svc:"MySQL"},{port:3389,svc:"RDP"},
  {port:5432,svc:"PostgreSQL"},{port:6379,svc:"Redis"},{port:8080,svc:"HTTP-Alt"},
  {port:8443,svc:"HTTPS-Alt"},{port:27017,svc:"MongoDB"},{port:161,svc:"SNMP"},
];

function genId(){ return Math.random().toString(36).slice(2,9); }
function classifyLatency(ms){
  if(ms===null) return "timeout";
  if(ms<5)  return "excellent";
  if(ms<20) return "good";
  if(ms<80) return "fair";
  return "poor";
}
const LC = { excellent:"#00e5a0", good:"#4ade80", fair:"#fbbf24", poor:"#f97316", timeout:"#ef4444" };
const LL = { excellent:"Mükemmel", good:"İyi", fair:"Orta", poor:"Yüksek", timeout:"Timeout" };

function fmtTime(ts){ return new Date(ts).toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function fmtDate(ts){ return new Date(ts).toLocaleString("tr-TR"); }

async function fakePing(ip, pSize){
  const parts=ip.split(".").map(Number);
  const base=((parts[2]||0)*3+(parts[3]||0))%80;
  const ms=Math.max(1, base+Math.random()*30-5+pSize*0.001);
  await new Promise(r=>setTimeout(r,Math.min(ms*2,400)));
  if(Math.random()<0.04) return null;
  return Math.round(ms*10)/10;
}

async function fakeTraceroute(ip){
  const hops=[];
  const parts=ip.split(".").map(Number);
  const hopCount=4+Math.floor(Math.random()*8);
  for(let i=1;i<=hopCount;i++){
    await new Promise(r=>setTimeout(r,80+Math.random()*120));
    const timeout=Math.random()<0.05;
    const ms=timeout?null:Math.round((i*8+Math.random()*15)*10)/10;
    const isLast=i===hopCount;
    hops.push({
      hop:i,
      ip: isLast ? ip : `10.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}`,
      hostname: isLast ? ip : (Math.random()>0.5?`router-${i}.isp.net`:"*"),
      ms, ms2: timeout?null:Math.round((ms+(Math.random()*4-2))*10)/10,
      ms3: timeout?null:Math.round((ms+(Math.random()*4-2))*10)/10,
      timeout,
    });
  }
  return hops;
}

async function fakePortScan(ip, ports){
  const results=[];
  for(const p of ports){
    await new Promise(r=>setTimeout(r,30+Math.random()*60));
    const open=Math.random()<0.35;
    results.push({ port:p.port, service:p.svc, open, latency:open?Math.round(Math.random()*80+2):null });
  }
  return results;
}

async function fakeDnsResolve(domain){
  await new Promise(r=>setTimeout(r,200+Math.random()*300));
  if(!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return { error:"Geçersiz domain formatı" };
  const ips=[`${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}`];
  if(Math.random()>0.6) ips.push(`${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}.${Math.floor(Math.random()*254)+1}`);
  return { domain, ips, ttl:Math.floor(Math.random()*3600+300), resolvedAt:Date.now() };
}

async function fakeSubnetScan(subnet){
  const results=[];
  const base=subnet.split(".").slice(0,3).join(".");
  const count=8+Math.floor(Math.random()*12);
  const used=new Set();
  for(let i=0;i<count;i++){
    let last;
    do{ last=Math.floor(Math.random()*254)+1; }while(used.has(last));
    used.add(last);
    await new Promise(r=>setTimeout(r,40));
    const ms=Math.round(Math.random()*60+1);
    results.push({
      ip:`${base}.${last}`,
      ms, alive:true,
      hostname: Math.random()>0.5?`host-${last}.local`:"",
      mac: Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,"0")).join(":"),
    });
  }
  return results.sort((a,b)=>parseInt(a.ip.split(".")[3])-parseInt(b.ip.split(".")[3]));
}

function calcJitter(pings){
  const v=pings.filter(p=>p!==null);
  if(v.length<2) return 0;
  let sum=0;
  for(let i=1;i<v.length;i++) sum+=Math.abs(v[i]-v[i-1]);
  return Math.round((sum/(v.length-1))*10)/10;
}

// ══════════════════════════════════════════════════════════════════════════════
// THEMES
// ══════════════════════════════════════════════════════════════════════════════
const DARK={
  bg:"#0a0d14",surface:"rgba(15,20,35,0.92)",surfaceAlt:"#0d1120",
  border:"#1e2840",borderMid:"#2a3550",
  textPrimary:"#e8eeff",textSecond:"#8a94b8",textMuted:"#6a74a0",textDim:"#3a4060",
  sidebarBg:"rgba(10,14,22,0.97)",headerBg:"rgba(12,17,30,0.97)",
  inputBg:"#111825",chartBg:"#0a0d1488",accent:"#00e5a0",accentGlow:"#00e5a044",
  rowAlt:"rgba(255,255,255,0.02)",
};
const LIGHT={
  bg:"#eef1f8",surface:"rgba(255,255,255,0.97)",surfaceAlt:"#f5f7fc",
  border:"#d0d8ee",borderMid:"#b8c4de",
  textPrimary:"#1a2040",textSecond:"#3a4870",textMuted:"#5a6890",textDim:"#9aa8c8",
  sidebarBg:"rgba(222,228,244,0.97)",headerBg:"rgba(212,220,238,0.97)",
  inputBg:"#ffffff",chartBg:"#e8edf888",accent:"#0055cc",accentGlow:"#0055cc33",
  rowAlt:"rgba(0,0,0,0.025)",
};

// ══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function PingChart({ pings, color, T }){
  const data=pings.map((v,i)=>({ i, ms:v===null?0:v, isNull:v===null }));
  const maxV=Math.max(...pings.filter(Boolean),10);
  return(
    <div style={{ background:T.chartBg,borderRadius:4,padding:"6px 4px 4px",marginTop:8 }}>
      <ResponsiveContainer width="100%" height={56}>
        <LineChart data={data} margin={{top:4,right:4,bottom:0,left:0}}>
          <XAxis dataKey="i" hide /><YAxis domain={[0,maxV*1.4]} hide />
          <Tooltip content={({active,payload})=>{
            if(!active||!payload?.length) return null;
            const v=pings[payload[0].payload.i];
            return <div style={{background:T.surface,border:`1px solid ${T.border}`,padding:"4px 8px",borderRadius:3,fontSize:12,color:T.textPrimary}}>{v===null?"Timeout":`${v} ms`}</div>;
          }}/>
          <Line type="monotone" dataKey="ms" stroke={color} strokeWidth={2}
            dot={(props)=>{ const{cx,cy,index}=props; const isTO=pings[index]===null;
              return <circle key={index} cx={cx} cy={isTO?48:cy} r={isTO?3:2} fill={isTO?"#ef4444":color} stroke="none"/>; }}
            activeDot={{r:4,fill:color}}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function JitterPanel({ pings, color, T }){
  if(!pings||pings.length<2) return null;
  const valid=pings.filter(p=>p!==null);
  const jitter=calcJitter(pings);
  const loss=Math.round((pings.filter(p=>p===null).length/pings.length)*100);
  const avg=valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length*10)/10:null;
  const stddev=valid.length>1?Math.round(Math.sqrt(valid.reduce((s,v)=>s+Math.pow(v-(avg||0),2),0)/valid.length)*10)/10:0;

  const diffData=[];
  for(let i=1;i<pings.length;i++){
    const a=pings[i-1], b=pings[i];
    diffData.push({ i, diff: (a!==null&&b!==null)?Math.abs(b-a):null });
  }

  return(
    <div style={{marginTop:12,padding:"10px 12px",background:T.chartBg,borderRadius:4}}>
      <div style={{fontSize:11,letterSpacing:1.5,color:T.textMuted,marginBottom:8,fontFamily:"'Share Tech Mono',monospace"}}>
        JİTTER ANALİZİ
      </div>
      <div style={{display:"flex",gap:0,marginBottom:10}}>
        {[["JİTTER",`${jitter}ms`,jitter>20?"#f97316":jitter>8?"#fbbf24":"#00e5a0"],
          ["STD-DEV",`${stddev}ms`,T.textPrimary],
          ["KAYIP",`%${loss}`,loss>0?"#ef4444":"#00e5a0"],
          ["ÖRNEK",`${pings.length}`,T.textPrimary],
        ].map(([l,v,c])=>(
          <div key={l} style={{flex:1,textAlign:"center",padding:"5px 4px",borderRight:`1px solid ${T.border}`}}>
            <div style={{fontSize:15,fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:c}}>{v}</div>
            <div style={{fontSize:10,letterSpacing:1.5,color:T.textMuted,marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={40}>
        <BarChart data={diffData} margin={{top:2,right:2,bottom:0,left:0}}>
          <XAxis dataKey="i" hide /><YAxis hide />
          <Tooltip content={({active,payload})=>{
            if(!active||!payload?.length||payload[0].value===null) return null;
            return <div style={{background:T.surface,border:`1px solid ${T.border}`,padding:"3px 7px",borderRadius:3,fontSize:11,color:T.textPrimary}}>{payload[0].value} ms fark</div>;
          }}/>
          <Bar dataKey="diff" fill={color} radius={[2,2,0,0]} opacity={0.8}/>
        </BarChart>
      </ResponsiveContainer>
      <div style={{fontSize:10,color:T.textDim,marginTop:4,textAlign:"center",fontFamily:"'Share Tech Mono',monospace"}}>
        Ping-arası değişim (ms)
      </div>
    </div>
  );
}

function QuickPingPanel({ T }){
  const [target,     setTarget]     = useState("");
  const [count,      setCount]      = useState(4);
  const [packetSize, setPacketSize] = useState(32);
  const [pings,      setPings]      = useState([]);
  const [running,    setRunning]    = useState(false);
  const [done,       setDone]       = useState(false);
  const abortRef = useRef(false);

  const start = async () => {
    if(!target.trim() || running) return;
    setPings([]); setDone(false); setRunning(true); abortRef.current = false;
    const c = Math.min(Math.max(parseInt(count)||4, 1), 20);
    const pSize = Math.min(Math.max(parseInt(packetSize)||32, 8), 65500);

    if(window.electronAPI){
      for(let i = 0; i < c; i++){
        if(abortRef.current) break;
        const r = await window.electronAPI.ping({ ip: target.trim(), count: 1, packetSize: pSize });
        const ms = r.error ? null : (r.results[0] ?? null);
        setPings(prev => [...prev, { seq: i+1, ms, ts: Date.now() }]);
        if(i < c-1) await new Promise(r => setTimeout(r, 500));
      }
    } else {
      for(let i = 0; i < c; i++){
        if(abortRef.current) break;
        const ms = await fakePing(target.trim(), pSize);
        setPings(prev => [...prev, { seq: i+1, ms, ts: Date.now() }]);
        if(i < c-1) await new Promise(r => setTimeout(r, 800));
      }
    }
    setRunning(false); setDone(true);
  };
  const stop = () => { abortRef.current = true; setRunning(false); };

  const valid  = pings.filter(p => p.ms !== null);
  const lost   = pings.filter(p => p.ms === null).length;
  const avg    = valid.length ? Math.round(valid.reduce((a,b)=>a+b.ms,0)/valid.length*10)/10 : null;
  const minMs  = valid.length ? Math.min(...valid.map(p=>p.ms)) : null;
  const maxMs  = valid.length ? Math.max(...valid.map(p=>p.ms)) : null;
  const jitter = calcJitter(pings.map(p=>p.ms));

  return (
    <div style={{padding:24, height:"100%", overflowY:"auto"}}>
      <div style={{fontSize:20,fontWeight:700,letterSpacing:2,color:T.textPrimary,marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
        <span style={{color:T.accent}}>⚡</span> HIZLI PİNG
      </div>
      <div style={{fontSize:12,color:T.textMuted,marginBottom:20,fontFamily:"'Share Tech Mono',monospace"}}>
        Tek bir IP veya domain'e anlık ping at
      </div>

      <div style={{display:"flex",gap:10,marginBottom:24,flexWrap:"wrap"}}>
        <input value={target} onChange={e=>setTarget(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&start()}
          placeholder="IP veya domain (ör: 192.168.1.1)"
          style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
            padding:"10px 14px",fontSize:14,fontFamily:"'Rajdhani',sans-serif",
            borderRadius:4,outline:"none",flex:1,minWidth:200}}/>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          <label style={{fontSize:10,color:T.textMuted,letterSpacing:1.5,fontFamily:"'Share Tech Mono',monospace"}}>PING SAYISI</label>
          <input type="number" value={count} min={1} max={20} onChange={e=>setCount(e.target.value)}
            style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
              padding:"9px 10px",width:80,fontSize:14,fontFamily:"'Share Tech Mono',monospace",
              borderRadius:4,outline:"none"}}/>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          <label style={{fontSize:10,color:T.textMuted,letterSpacing:1.5,fontFamily:"'Share Tech Mono',monospace"}}>PAKET (byte)</label>
          <input type="number" value={packetSize} min={8} max={65500} onChange={e=>setPacketSize(e.target.value)}
            style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
              padding:"9px 10px",width:100,fontSize:14,fontFamily:"'Share Tech Mono',monospace",
              borderRadius:4,outline:"none"}}/>
        </div>
        {running ? (
          <button onClick={stop} style={{background:"#ef444422",border:"1px solid #ef4444",color:"#ef4444",
            padding:"10px 22px",cursor:"pointer",fontSize:13,fontWeight:700,letterSpacing:1.5,
            fontFamily:"'Rajdhani',sans-serif",borderRadius:4,alignSelf:"flex-end"}}>■ DURDUR</button>
        ):(
          <button onClick={start} style={{background:`linear-gradient(135deg,${T.accent},#00c87a)`,
            border:"none",color:"#0a0d14",padding:"10px 22px",cursor:"pointer",fontSize:13,
            fontWeight:700,letterSpacing:1.5,fontFamily:"'Rajdhani',sans-serif",borderRadius:4,alignSelf:"flex-end"}}>
            ▶ PING AT
          </button>
        )}
      </div>

      {pings.length > 0 && (
        <>
          {/* Özet istatistikler */}
          {done && (
            <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
              {[["ORT", avg!==null?`${avg}ms`:"—", T.accent],
                ["MIN", minMs!==null?`${minMs}ms`:"—", "#4ade80"],
                ["MAX", maxMs!==null?`${maxMs}ms`:"—", "#f97316"],
                ["JİTTER", `${jitter}ms`, jitter>20?"#f97316":jitter>8?"#fbbf24":"#00e5a0"],
                ["KAYIP", `%${Math.round(lost/pings.length*100)}`, lost>0?"#ef4444":"#00e5a0"],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
                  padding:"10px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:90}}>
                  <span style={{fontSize:20,fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:c}}>{v}</span>
                  <span style={{fontSize:10,letterSpacing:2,color:T.textMuted}}>{l}</span>
                </div>
              ))}
            </div>
          )}

          {/* Ping listesi */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"60px 1fr 100px 120px",
              padding:"8px 16px",background:T.surfaceAlt,borderBottom:`1px solid ${T.border}`,
              fontSize:10,letterSpacing:1.5,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>
              <span>SEQ</span><span>HEDEF</span><span>SONUÇ</span><span>DURUM</span>
            </div>
            {pings.map((p,i)=>{
              const latCls = classifyLatency(p.ms);
              const c = LC[latCls];
              return(
                <div key={i} style={{display:"grid",gridTemplateColumns:"60px 1fr 100px 120px",
                  padding:"9px 16px",borderBottom:`1px solid ${T.border}22`,
                  background:i%2===0?"transparent":T.rowAlt,
                  fontSize:13,alignItems:"center",animation:"fadeIn 0.2s ease"}}>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",color:T.textMuted}}>#{p.seq}</span>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",color:T.textSecond}}>{target}</span>
                  <span style={{fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:c}}>
                    {p.ms===null?"TIMEOUT":`${p.ms} ms`}
                  </span>
                  <span style={{fontSize:11,background:`${c}22`,color:c,border:`1px solid ${c}44`,
                    padding:"2px 10px",borderRadius:2,display:"inline-block",width:"fit-content"}}>
                    {LL[latCls]}
                  </span>
                </div>
              );
            })}
            {running && (
              <div style={{padding:"10px 16px",fontSize:12,color:T.accent,
                fontFamily:"'Share Tech Mono',monospace",borderTop:`1px solid ${T.border}`}}>
                ⟳ Ping gönderiliyor... ({pings.length}/{count})
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TraceroutePanel({ T }){
  const [target,setTarget]=useState("");
  const [hops,setHops]=useState([]);
  const [running,setRunning]=useState(false);
  const [done,setDone]=useState(false);
  const abortRef=useRef(false);

  const start=async()=>{
    if(!target.trim()||running) return;
    setHops([]); setDone(false); setRunning(true); abortRef.current=false;

    if(window.electronAPI){
      // Gerçek tracert - tamamlanınca tüm hop'lar gelir
      const result = await window.electronAPI.traceroute({ ip: target.trim() });
      if(!abortRef.current) setHops(result||[]);
    } else {
      // Tarayıcıda simülasyon
      const result=await fakeTraceroute(target.trim());
      for(const hop of result){
        if(abortRef.current) break;
        setHops(prev=>[...prev,hop]);
        await new Promise(r=>setTimeout(r,150));
      }
    }
    setRunning(false); setDone(true);
  };
  const stop=()=>{ abortRef.current=true; setRunning(false); setDone(true); };

  const maxMs=Math.max(...hops.map(h=>Math.max(h.ms||0,h.ms2||0,h.ms3||0)),1);

  return(
    <div style={{padding:24,height:"100%",overflowY:"auto"}}>
      <div style={{fontSize:20,fontWeight:700,letterSpacing:2,color:T.textPrimary,marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
        <span style={{color:T.accent}}>⇢</span> TRACEROUTE
      </div>
      <div style={{fontSize:12,color:T.textMuted,marginBottom:20,fontFamily:"'Share Tech Mono',monospace"}}>
        Hedef IP veya domain'e atlama atlama rota takibi
      </div>

      <div style={{display:"flex",gap:10,marginBottom:24}}>
        <input value={target} onChange={e=>setTarget(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&start()} placeholder="IP veya domain (ör: 8.8.8.8)"
          style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
            padding:"10px 14px",fontSize:14,fontFamily:"'Rajdhani',sans-serif",
            borderRadius:4,outline:"none",flex:1}} />
        {running?(
          <button onClick={stop} style={{background:"#ef444422",border:"1px solid #ef4444",color:"#ef4444",
            padding:"10px 22px",cursor:"pointer",fontSize:13,fontWeight:700,letterSpacing:1.5,
            fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>■ DURDUR</button>
        ):(
          <button onClick={start} style={{background:`linear-gradient(135deg,${T.accent},#00c87a)`,
            border:"none",color:"#0a0d14",padding:"10px 22px",cursor:"pointer",fontSize:13,
            fontWeight:700,letterSpacing:1.5,fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>
            ▶ BAŞLAT
          </button>
        )}
      </div>

      {hops.length>0&&(
        <div style={{background:T.surface,borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden"}}>
          {/* Header row */}
          <div style={{display:"grid",gridTemplateColumns:"40px 160px 1fr 70px 70px 70px 120px",
            padding:"8px 14px",background:T.surfaceAlt,borderBottom:`1px solid ${T.border}`,
            fontSize:10,letterSpacing:1.5,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>
            <span>HOP</span><span>IP ADRESİ</span><span>HOSTNAME</span>
            <span>MS-1</span><span>MS-2</span><span>MS-3</span><span>GECIKME BARR</span>
          </div>
          {hops.map((h,i)=>{
            const barW=h.ms?Math.min((h.ms/maxMs)*100,100):0;
            const c=h.timeout?"#ef4444":LC[classifyLatency(h.ms)];
            return(
              <div key={i} style={{display:"grid",gridTemplateColumns:"40px 160px 1fr 70px 70px 70px 120px",
                padding:"9px 14px",borderBottom:`1px solid ${T.border}22`,
                background:i%2===0?"transparent":T.rowAlt,
                fontSize:13,alignItems:"center",animation:"fadeIn 0.2s ease"}}>
                <span style={{color:T.accent,fontFamily:"'Share Tech Mono',monospace",fontWeight:700}}>{h.hop}</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:T.textSecond}}>{h.ip}</span>
                <span style={{color:T.textMuted,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.hostname||"—"}</span>
                {[h.ms,h.ms2,h.ms3].map((m,mi)=>(
                  <span key={mi} style={{color:m===null?"#ef4444":c,fontFamily:"'Share Tech Mono',monospace",fontWeight:700,fontSize:13}}>
                    {m===null?"*":` ${m}`}
                  </span>
                ))}
                <div style={{background:T.chartBg,borderRadius:2,height:6,overflow:"hidden"}}>
                  <div style={{width:`${barW}%`,height:"100%",background:c,borderRadius:2,transition:"width 0.4s"}}/>
                </div>
              </div>
            );
          })}
          {running&&(
            <div style={{padding:"10px 14px",fontSize:12,color:T.accent,fontFamily:"'Share Tech Mono',monospace",
              borderTop:`1px solid ${T.border}`}}>
              ⟳ Taranıyor...
            </div>
          )}
          {done&&(
            <div style={{padding:"10px 14px",fontSize:12,color:"#00e5a0",fontFamily:"'Share Tech Mono',monospace",
              borderTop:`1px solid ${T.border}`}}>
              ✓ Tamamlandı — {hops.length} atlama
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PortScanPanel({ T }){
  const [target,setTarget]=useState("");
  const [results,setResults]=useState([]);
  const [running,setRunning]=useState(false);
  const [customPorts,setCustomPorts]=useState("");
  const [mode,setMode]=useState("common"); // "common"|"custom"
  const abortRef=useRef(false);

  const start=async()=>{
    if(!target.trim()||running) return;
    setResults([]); setRunning(true); abortRef.current=false;
    let ports=COMMON_PORTS;
    if(mode==="custom"){
      ports=customPorts.split(/[,\s]+/).filter(Boolean).map(p=>{
        const n=parseInt(p); return n>0&&n<65536?{port:n,svc:`Port ${n}`}:null;
      }).filter(Boolean);
    }

    if(window.electronAPI){
      // Gerçek TCP port tarama - tüm sonuçlar birden gelir
      const scanned = await window.electronAPI.portScan({ ip: target.trim(), ports });
      if(!abortRef.current) setResults(scanned);
    } else {
      // Tarayıcıda simülasyon - tek tek gelsin
      for(const p of ports){
        if(abortRef.current) break;
        await new Promise(r=>setTimeout(r,25));
        const open=Math.random()<0.3;
        setResults(prev=>[...prev,{port:p.port,service:p.svc,open,latency:open?Math.round(Math.random()*80+2):null}]);
      }
    }
    setRunning(false);
  };

  const open=results.filter(r=>r.open);
  const closed=results.filter(r=>!r.open);

  return(
    <div style={{padding:24,height:"100%",overflowY:"auto"}}>
      <div style={{fontSize:20,fontWeight:700,letterSpacing:2,color:T.textPrimary,marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
        <span style={{color:T.accent}}>⊞</span> PORT & SERVİS KONTROLÜ
      </div>
      <div style={{fontSize:12,color:T.textMuted,marginBottom:20,fontFamily:"'Share Tech Mono',monospace"}}>
        Hedef sistemde açık/kapalı port ve servis tespiti
      </div>

      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <input value={target} onChange={e=>setTarget(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&start()} placeholder="IP veya hostname"
          style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
            padding:"10px 14px",fontSize:14,fontFamily:"'Rajdhani',sans-serif",
            borderRadius:4,outline:"none",flex:1,minWidth:200}}/>
        <div style={{display:"flex",gap:6}}>
          {["common","custom"].map(m=>(
            <button key={m} onClick={()=>setMode(m)}
              style={{background:mode===m?`${T.accent}18`:"transparent",
                border:`1px solid ${mode===m?T.accent:T.borderMid}`,
                color:mode===m?T.accent:T.textMuted,
                padding:"10px 14px",cursor:"pointer",fontSize:12,letterSpacing:1,
                fontFamily:"'Rajdhani',sans-serif",fontWeight:600,borderRadius:4}}>
              {m==="common"?"YAYGN PORTLAR":"ÖZEL PORTLAR"}
            </button>
          ))}
        </div>
        {running?(
          <button onClick={()=>{ abortRef.current=true; setRunning(false); }}
            style={{background:"#ef444422",border:"1px solid #ef4444",color:"#ef4444",
              padding:"10px 22px",cursor:"pointer",fontSize:13,fontWeight:700,
              fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>■ DURDUR</button>
        ):(
          <button onClick={start}
            style={{background:`linear-gradient(135deg,${T.accent},#00c87a)`,
              border:"none",color:"#0a0d14",padding:"10px 22px",cursor:"pointer",fontSize:13,
              fontWeight:700,letterSpacing:1.5,fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>
            ▶ TARA
          </button>
        )}
      </div>

      {mode==="custom"&&(
        <input value={customPorts} onChange={e=>setCustomPorts(e.target.value)}
          placeholder="Port numaraları (ör: 80, 443, 8080, 3306)"
          style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
            padding:"8px 14px",fontSize:13,fontFamily:"'Share Tech Mono',monospace",
            borderRadius:4,outline:"none",width:"100%",marginBottom:12}}/>
      )}

      {results.length>0&&(
        <>
          <div style={{display:"flex",gap:12,marginBottom:16}}>
            {[["AÇIK",open.length,"#00e5a0"],["KAPALI",closed.length,"#ef4444"],["TOPLAM",results.length,T.textSecond]].map(([l,v,c])=>(
              <div key={l} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
                padding:"10px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <span style={{fontSize:22,fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:c}}>{v}</span>
                <span style={{fontSize:10,letterSpacing:2,color:T.textMuted}}>{l}</span>
              </div>
            ))}
          </div>

          <div style={{background:T.surface,borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"80px 80px 1fr 100px 80px",
              padding:"8px 14px",background:T.surfaceAlt,borderBottom:`1px solid ${T.border}`,
              fontSize:10,letterSpacing:1.5,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>
              <span>PORT</span><span>DURUM</span><span>SERVİS</span><span>GECİKME</span><span></span>
            </div>
            {results.map((r,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"80px 80px 1fr 100px 80px",
                padding:"8px 14px",borderBottom:`1px solid ${T.border}22`,
                background:i%2===0?"transparent":T.rowAlt,
                fontSize:13,alignItems:"center"}}>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontWeight:700,color:T.textPrimary}}>{r.port}</span>
                <span>
                  <span style={{background:r.open?"#00e5a022":"#ef444422",
                    color:r.open?"#00e5a0":"#ef4444",border:`1px solid ${r.open?"#00e5a044":"#ef444444"}`,
                    padding:"2px 8px",borderRadius:2,fontSize:11,letterSpacing:1}}>
                    {r.open?"AÇIK":"KAPALI"}
                  </span>
                </span>
                <span style={{color:T.textSecond}}>{r.service}</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",color:r.latency?T.accent:T.textDim}}>
                  {r.latency?`${r.latency}ms`:"—"}
                </span>
              </div>
            ))}
            {running&&(
              <div style={{padding:"10px 14px",fontSize:12,color:T.accent,fontFamily:"'Share Tech Mono',monospace"}}>
                ⟳ Taranıyor... ({results.length} / {mode==="common"?COMMON_PORTS.length:"?"})
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DnsPanel({ T }){
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [loading,setLoading]=useState(false);

  const resolve=async()=>{
    if(!query.trim()||loading) return;
    setLoading(true);
    let r;
    if(window.electronAPI){
      r = await window.electronAPI.dnsResolve({ domain: query.trim() });
    } else {
      r = await fakeDnsResolve(query.trim());
    }
    setResults(prev=>[{...r, query:query.trim()}, ...prev].slice(0,20));
    setLoading(false);
  };

  return(
    <div style={{padding:24,height:"100%",overflowY:"auto"}}>
      <div style={{fontSize:20,fontWeight:700,letterSpacing:2,color:T.textPrimary,marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
        <span style={{color:T.accent}}>◉</span> DNS ÇÖZÜMLEME
      </div>
      <div style={{fontSize:12,color:T.textMuted,marginBottom:20,fontFamily:"'Share Tech Mono',monospace"}}>
        Domain adını IP adresine çevir
      </div>

      <div style={{display:"flex",gap:10,marginBottom:24}}>
        <input value={query} onChange={e=>setQuery(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&resolve()} placeholder="Domain (ör: google.com)"
          style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
            padding:"10px 14px",fontSize:14,fontFamily:"'Rajdhani',sans-serif",
            borderRadius:4,outline:"none",flex:1}}/>
        <button onClick={resolve} disabled={loading}
          style={{background:`linear-gradient(135deg,${T.accent},#00c87a)`,
            border:"none",color:"#0a0d14",padding:"10px 22px",cursor:"pointer",fontSize:13,
            fontWeight:700,letterSpacing:1.5,fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>
          {loading?"⟳ SORGU...":"ÇÖZÜMLE"}
        </button>
      </div>

      {results.map((r,i)=>(
        <div key={i} style={{background:T.surface,border:`1px solid ${r.error?"#ef444455":T.border}`,
          borderRadius:6,padding:"14px 18px",marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:r.error?0:10}}>
            <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,fontWeight:700,color:T.textPrimary}}>{r.query}</span>
            <span style={{fontSize:11,color:T.textMuted}}>{r.resolvedAt?fmtTime(r.resolvedAt):""}</span>
          </div>
          {r.error?(
            <div style={{fontSize:13,color:"#ef4444"}}>{r.error}</div>
          ):(
            <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:10,letterSpacing:1.5,color:T.textMuted,marginBottom:4,fontFamily:"'Share Tech Mono',monospace"}}>IP ADRESLERİ</div>
                {r.ips.map((ip,j)=>(
                  <div key={j} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:T.accent,fontWeight:700}}>{ip}</div>
                ))}
              </div>
              <div>
                <div style={{fontSize:10,letterSpacing:1.5,color:T.textMuted,marginBottom:4,fontFamily:"'Share Tech Mono',monospace"}}>TTL</div>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:T.textSecond}}>{r.ttl}s</div>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SubnetPanel({ T }){
  const [ip,     setIp]     = useState("192.168.1.0");
  const [mask,   setMask]   = useState("24");
  const [results,setResults]= useState([]);
  const [running,setRunning]= useState(false);
  const [progress,setProgress]=useState(0);
  const [error,  setError]  = useState("");

  // IP'den subnet base hesapla
  const getBase = () => {
    const parts = ip.trim().split(".").map(Number);
    if(parts.length!==4 || parts.some(p=>isNaN(p)||p<0||p>255))
      return null;
    const m = parseInt(mask);
    if(isNaN(m)||m<1||m>30) return null;
    // /24 için sadece ilk 3 oktet kullan
    if(m===24) return parts.slice(0,3).join(".");
    // Diğer maskeler için de base IP'yi döndür
    return parts.slice(0,3).join(".");
  };

  const scan = async () => {
    const base = getBase();
    if(!base){ setError("Geçerli bir IP ve subnet mask girin (örn: 192.168.1.0 / 24)"); return; }
    setError(""); setResults([]); setRunning(true); setProgress(0);

    if(window.electronAPI){
      // Gerçek tarama — main.js'te önce 254 ping atar sonra arp -a okur
      // Progress simüle et (arp taraması bitmeden sonuç gelmez)
      const interval = setInterval(()=>{ setProgress(p=>Math.min(p+1, 90)); }, 1200);
      try {
        const found = await window.electronAPI.subnetScan({ subnet: base });
        clearInterval(interval);
        setProgress(100);
        setResults(found);
      } catch(e) {
        clearInterval(interval);
        setError("Tarama başarısız: " + e.message);
      }
    } else {
      // Tarayıcıda simülasyon
      const found = await fakeSubnetScan(base);
      for(const h of found){
        setResults(prev=>[...prev, h]);
        setProgress(prev=>Math.min(prev+5,99));
        await new Promise(r=>setTimeout(r,60));
      }
      setProgress(100);
    }
    setRunning(false);
  };

  const maskOptions = ["24","23","22","21","20","16"];
  const hostCount   = Math.pow(2, 32-parseInt(mask||24)) - 2;

  return(
    <div style={{padding:24,height:"100%",overflowY:"auto"}}>
      <div style={{fontSize:20,fontWeight:700,letterSpacing:2,color:T.textPrimary,marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
        <span style={{color:T.accent}}>⊙</span> AĞ TARAMASI
      </div>
      <div style={{fontSize:12,color:T.textMuted,marginBottom:20,fontFamily:"'Share Tech Mono',monospace"}}>
        Subnet üzerindeki canlı cihazları tespit et (ARP + Ping)
      </div>

      {/* IP + Mask girişi */}
      <div style={{display:"flex",gap:10,marginBottom:error?8:24,alignItems:"flex-end",flexWrap:"wrap"}}>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:11,letterSpacing:1.5,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>AĞ ADRESİ</label>
          <input value={ip} onChange={e=>setIp(e.target.value)}
            placeholder="192.168.1.0"
            style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
              padding:"9px 14px",fontSize:14,fontFamily:"'Share Tech Mono',monospace",
              borderRadius:4,outline:"none",width:180}}/>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:11,letterSpacing:1.5,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>SUBNET MASK</label>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{color:T.textMuted,fontSize:18,fontFamily:"'Share Tech Mono',monospace"}}>/</span>
            <input type="number" value={mask} min={1} max={30}
              onChange={e=>setMask(e.target.value)}
              style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
                padding:"9px 10px",fontSize:14,fontFamily:"'Share Tech Mono',monospace",
                borderRadius:4,outline:"none",width:70}}/>
            <select value={mask} onChange={e=>setMask(e.target.value)}
              style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textMuted,
                padding:"9px 8px",fontSize:12,fontFamily:"'Share Tech Mono',monospace",
                borderRadius:4,outline:"none",cursor:"pointer"}}>
              {maskOptions.map(m=>(
                <option key={m} value={m}>/{m} ({Math.pow(2,32-parseInt(m))-2} host)</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:11,letterSpacing:1.5,color:"transparent",fontFamily:"'Share Tech Mono',monospace"}}>.</label>
          {running?(
            <button onClick={()=>setRunning(false)}
              style={{background:"#ef444422",border:"1px solid #ef4444",color:"#ef4444",
                padding:"10px 22px",cursor:"pointer",fontSize:13,fontWeight:700,
                fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>■ DURDUR</button>
          ):(
            <button onClick={scan}
              style={{background:`linear-gradient(135deg,${T.accent},#00c87a)`,
                border:"none",color:"#0a0d14",padding:"10px 22px",cursor:"pointer",fontSize:13,
                fontWeight:700,letterSpacing:1.5,fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>
              ▶ TARA
            </button>
          )}
        </div>

        {/* Bilgi kutusu */}
        <div style={{background:T.surfaceAlt,border:`1px solid ${T.border}`,borderRadius:4,
          padding:"6px 14px",fontSize:12,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace",alignSelf:"flex-end"}}>
          {ip.split(".").slice(0,3).join(".")}.1 — .{Math.pow(2,32-parseInt(mask||24))-2} · {hostCount} host
        </div>
      </div>

      {error&&(
        <div style={{background:"#ef444418",border:"1px solid #ef444444",borderRadius:4,
          padding:"8px 14px",fontSize:13,color:"#ef4444",marginBottom:16,fontFamily:"'Share Tech Mono',monospace"}}>
          ⚠ {error}
        </div>
      )}

      {/* Progress bar */}
      {running&&(
        <div style={{marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{fontSize:12,color:T.accent,fontFamily:"'Share Tech Mono',monospace"}}>
              ⟳ Taranıyor... {results.length} cihaz bulundu
            </span>
            <span style={{fontSize:12,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>{progress}%</span>
          </div>
          <div style={{background:T.border,borderRadius:3,height:5,overflow:"hidden"}}>
            <div style={{height:"100%",background:T.accent,width:`${progress}%`,
              transition:"width 0.5s",borderRadius:3,boxShadow:`0 0 8px ${T.accent}`}}/>
          </div>
          <div style={{fontSize:11,color:T.textDim,marginTop:4,fontFamily:"'Share Tech Mono',monospace"}}>
            {progress<90?"Ping gönderiliyor (254 host)...":"ARP tablosu okunuyor..."}
          </div>
        </div>
      )}

      {/* Sonuçlar */}
      {results.length>0&&(
        <>
          <div style={{display:"flex",gap:10,marginBottom:12}}>
            <div style={{background:T.surface,border:`1px solid #00e5a044`,borderRadius:5,
              padding:"8px 16px",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:18,fontWeight:700,color:"#00e5a0",fontFamily:"'Share Tech Mono',monospace"}}>{results.length}</span>
              <span style={{fontSize:11,color:T.textMuted,letterSpacing:1}}>AKTİF CİHAZ</span>
            </div>
          </div>

          <div style={{background:T.surface,borderRadius:6,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"150px 170px 1fr 90px",
              padding:"8px 14px",background:T.surfaceAlt,borderBottom:`1px solid ${T.border}`,
              fontSize:10,letterSpacing:1.5,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>
              <span>IP ADRESİ</span><span>MAC ADRESİ</span><span>HOSTNAME</span><span>DURUM</span>
            </div>
            {results.map((h,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"150px 170px 1fr 90px",
                padding:"9px 14px",borderBottom:`1px solid ${T.border}22`,
                background:i%2===0?"transparent":T.rowAlt,fontSize:13,alignItems:"center",
                animation:"fadeIn 0.3s ease"}}>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontWeight:700,color:T.accent}}>{h.ip}</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:T.textMuted}}>{h.mac||"—"}</span>
                <span style={{color:T.textSecond,fontSize:12}}>{h.hostname||"—"}</span>
                <span style={{fontSize:11,background:"#00e5a022",color:"#00e5a0",
                  border:"1px solid #00e5a044",padding:"2px 8px",borderRadius:2}}>AKTİF</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!running && results.length===0 && progress===100 &&(
        <div style={{textAlign:"center",color:T.textDim,fontSize:14,marginTop:40,fontFamily:"'Share Tech Mono',monospace"}}>
          Hiç aktif cihaz bulunamadı
        </div>
      )}
    </div>
  );
}

function ComparePanel({ groups, T }){
  const [hostA,setHostA]=useState(null);
  const [hostB,setHostB]=useState(null);
  const [pingsA,setPingsA]=useState([]);
  const [pingsB,setPingsB]=useState([]);
  const [running,setRunning]=useState(false);
  const [count,setCount]=useState(10);
  const abortRef=useRef(false);

  const allHosts=groups.flatMap(g=>g.hosts.map(h=>({...h,groupName:g.name})));

  const run=async()=>{
    if(!hostA||!hostB||running) return;
    setPingsA([]); setPingsB([]); setRunning(true); abortRef.current=false;
    const c=Math.min(Math.max(parseInt(count)||10,2),30);
    for(let i=0;i<c;i++){
      if(abortRef.current) break;
      if(window.electronAPI){
        const [rA,rB]=await Promise.all([
          window.electronAPI.ping({ip:hostA.ip,count:1,packetSize:32}),
          window.electronAPI.ping({ip:hostB.ip,count:1,packetSize:32}),
        ]);
        const mA=rA.error?null:(rA.results[0]??null);
        const mB=rB.error?null:(rB.results[0]??null);
        setPingsA(p=>[...p,mA]); setPingsB(p=>[...p,mB]);
      } else {
        const [mA,mB]=await Promise.all([fakePing(hostA.ip,32),fakePing(hostB.ip,32)]);
        setPingsA(p=>[...p,mA]); setPingsB(p=>[...p,mB]);
      }
      await new Promise(r=>setTimeout(r,600));
    }
    setRunning(false);
  };

  const statsOf=(pings)=>{
    const v=pings.filter(p=>p!==null);
    const avg=v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length*10)/10:null;
    return{ avg, min:v.length?Math.min(...v):null, max:v.length?Math.max(...v):null,
      loss:Math.round((pings.filter(p=>p===null).length/Math.max(pings.length,1))*100),
      jitter:calcJitter(pings), pings };
  };

  const sA=statsOf(pingsA), sB=statsOf(pingsB);
  const chartData=pingsA.map((v,i)=>({ i, A:v, B:pingsB[i]??null }));

  const SelBtn=({label,value,onChange,hosts})=>(
    <select value={value||""} onChange={e=>onChange(hosts.find(h=>h.id===e.target.value)||null)}
      style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
        padding:"9px 12px",fontSize:13,fontFamily:"'Rajdhani',sans-serif",
        borderRadius:4,outline:"none",flex:1}}>
      <option value="">{label}</option>
      {hosts.map(h=><option key={h.id} value={h.id}>{h.groupName} › {h.label} ({h.ip})</option>)}
    </select>
  );

  return(
    <div style={{padding:24,height:"100%",overflowY:"auto"}}>
      <div style={{fontSize:20,fontWeight:700,letterSpacing:2,color:T.textPrimary,marginBottom:4,display:"flex",alignItems:"center",gap:10}}>
        <span style={{color:T.accent}}>⇔</span> KARŞILAŞTIRMA MODU
      </div>
      <div style={{fontSize:12,color:T.textMuted,marginBottom:20,fontFamily:"'Share Tech Mono',monospace"}}>
        İki hostu eş zamanlı ping ile karşılaştır
      </div>

      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <SelBtn label="— Host A seç —" value={hostA?.id} onChange={setHostA} hosts={allHosts}/>
        <SelBtn label="— Host B seç —" value={hostB?.id} onChange={setHostB} hosts={allHosts}/>
        <input type="number" value={count} min={2} max={30} onChange={e=>setCount(e.target.value)}
          style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
            padding:"9px 10px",width:80,fontSize:14,fontFamily:"'Share Tech Mono',monospace",
            borderRadius:4,outline:"none"}}/>
        {running?(
          <button onClick={()=>{ abortRef.current=true; setRunning(false); }}
            style={{background:"#ef444422",border:"1px solid #ef4444",color:"#ef4444",
              padding:"10px 20px",cursor:"pointer",fontSize:13,fontWeight:700,
              fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>■ DURDUR</button>
        ):(
          <button onClick={run} disabled={!hostA||!hostB}
            style={{background:`linear-gradient(135deg,${T.accent},#00c87a)`,
              border:"none",color:"#0a0d14",padding:"10px 20px",cursor:"pointer",fontSize:13,
              fontWeight:700,letterSpacing:1.5,fontFamily:"'Rajdhani',sans-serif",borderRadius:4,
              opacity:(!hostA||!hostB)?0.5:1}}>
            ▶ KARŞILAŞTIR
          </button>
        )}
      </div>

      {pingsA.length>0&&(
        <>
          {/* Side by side stats */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            {[[hostA,sA,"#00e5a0"],[hostB,sB,"#a78bfa"]].map(([h,s,c],idx)=>(
              <div key={idx} style={{background:T.surface,border:`1px solid ${c}44`,borderRadius:6,padding:14}}>
                <div style={{fontSize:13,fontWeight:700,color:c,marginBottom:2}}>{h?.label}</div>
                <div style={{fontSize:11,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace",marginBottom:10}}>{h?.ip}</div>
                <div style={{display:"flex",gap:0}}>
                  {[["ORT",s.avg!==null?`${s.avg}ms`:"—"],[" MIN",s.min!==null?`${s.min}ms`:"—"],["MAX",s.max!==null?`${s.max}ms`:"—"],["JİTTER",`${s.jitter}ms`],["KAYIP",`%${s.loss}`]].map(([l,v])=>(
                    <div key={l} style={{flex:1,textAlign:"center",padding:"5px 2px",borderRight:`1px solid ${T.border}`}}>
                      <div style={{fontSize:14,fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:c}}>{v}</div>
                      <div style={{fontSize:9,letterSpacing:1.5,color:T.textMuted,marginTop:2}}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Combined chart */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:16}}>
            <div style={{fontSize:11,letterSpacing:1.5,color:T.textMuted,marginBottom:12,fontFamily:"'Share Tech Mono',monospace",display:"flex",gap:20}}>
              <span style={{color:"#00e5a0"}}>— {hostA?.label}</span>
              <span style={{color:"#a78bfa"}}>— {hostB?.label}</span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData} margin={{top:4,right:4,bottom:0,left:0}}>
                <XAxis dataKey="i" hide/><YAxis hide/>
                <Tooltip content={({active,payload})=>{
                  if(!active) return null;
                  return(
                    <div style={{background:T.surface,border:`1px solid ${T.border}`,padding:"6px 10px",borderRadius:3,fontSize:12}}>
                      {payload?.map((p,i)=>(
                        <div key={i} style={{color:p.color}}>{p.name}: {p.value===null?"Timeout":`${p.value}ms`}</div>
                      ))}
                    </div>
                  );
                }}/>
                <Line type="monotone" dataKey="A" stroke="#00e5a0" strokeWidth={2} dot={false} name={hostA?.label}/>
                <Line type="monotone" dataKey="B" stroke="#a78bfa" strokeWidth={2} dot={false} name={hostB?.label}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function LogPanel({ logs, onClear, groups, T }){
  const [filterGroup, setFilterGroup] = useState("all");
  const endRef = useRef(null);
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[logs]);

  const filtered = filterGroup==="all" ? logs : logs.filter(e=>e.groupId===filterGroup);

  const exportCSV = (logsToExport, filename) => {
    const header = "Saat,Grup,Host,IP,Sonuç (ms),Durum\n";
    const groupName = g => groups.find(gr=>gr.id===g)?.name || g || "—";
    const rows = logsToExport.map(e =>
      `${fmtDate(e.ts)},${groupName(e.groupId)},${e.label},${e.ip},${e.ms===null?"TIMEOUT":e.ms},${e.ms===null?"Zaman Aşımı":LL[classifyLatency(e.ms)]}`
    ).join("\n");
    const blob = new Blob(["\uFEFF"+header+rows],{type:"text/csv;charset=utf-8;"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename; a.click();
  };

  // Grup bazlı özet istatistikler
  const groupStats = groups.map(g => {
    const gLogs = logs.filter(e=>e.groupId===g.id);
    const valid  = gLogs.filter(e=>e.ms!==null);
    const avg    = valid.length ? Math.round(valid.reduce((a,b)=>a+b.ms,0)/valid.length*10)/10 : null;
    const loss   = gLogs.length ? Math.round(gLogs.filter(e=>e.ms===null).length/gLogs.length*100) : 0;
    return { ...g, count:gLogs.length, avg, loss };
  }).filter(g=>g.count>0);

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>

      {/* Header */}
      <div style={{padding:"14px 20px",borderBottom:`1px solid ${T.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={{fontSize:14,fontWeight:700,letterSpacing:2,color:T.textSecond,fontFamily:"'Share Tech Mono',monospace"}}>
            ◈ PING GEÇMİŞİ — {filtered.length} kayıt {filterGroup!=="all"&&`(toplam ${logs.length})`}
          </span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>exportCSV(filtered, `ping-log-${filterGroup==="all"?"tumu":groups.find(g=>g.id===filterGroup)?.name||filterGroup}-${new Date().toISOString().slice(0,10)}.csv`)}
              style={{background:`${T.accent}18`,border:`1px solid ${T.accent}44`,
                color:T.accent,fontSize:12,padding:"5px 14px",cursor:"pointer",borderRadius:3,
                fontFamily:"'Rajdhani',sans-serif",letterSpacing:1,fontWeight:600}}>
              ⬇ CSV {filterGroup!=="all"?`(${groups.find(g=>g.id===filterGroup)?.name})`: "(Tümü)"}
            </button>
            <button onClick={()=>onClear(filterGroup)}
              style={{background:"transparent",border:`1px solid ${T.borderMid}`,
                color:T.textMuted,fontSize:12,padding:"5px 14px",cursor:"pointer",borderRadius:3,
                fontFamily:"'Rajdhani',sans-serif",letterSpacing:1,fontWeight:600}}>
              {filterGroup==="all"?"Tümünü Temizle":"Grubu Temizle"}
            </button>
          </div>
        </div>

        {/* Grup filtre sekmeleri */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button onClick={()=>setFilterGroup("all")}
            style={{padding:"5px 14px",borderRadius:3,border:`1px solid ${filterGroup==="all"?T.accent:T.borderMid}`,
              background:filterGroup==="all"?`${T.accent}18`:"transparent",
              color:filterGroup==="all"?T.accent:T.textMuted,
              cursor:"pointer",fontSize:12,fontFamily:"'Rajdhani',sans-serif",fontWeight:600,letterSpacing:0.5}}>
            Tümü ({logs.length})
          </button>
          {groups.map(g=>{
            const gCount=logs.filter(e=>e.groupId===g.id).length;
            const isAct=filterGroup===g.id;
            return(
              <button key={g.id} onClick={()=>setFilterGroup(g.id)}
                style={{padding:"5px 14px",borderRadius:3,border:`1px solid ${isAct?T.accent:T.borderMid}`,
                  background:isAct?`${T.accent}18`:"transparent",
                  color:isAct?T.accent:T.textMuted,
                  cursor:"pointer",fontSize:12,fontFamily:"'Rajdhani',sans-serif",fontWeight:600,
                  display:"flex",alignItems:"center",gap:6}}>
                <span>{g.icon}</span>
                <span>{g.name}</span>
                <span style={{background:T.border,padding:"1px 6px",borderRadius:2,
                  fontSize:11,fontFamily:"'Share Tech Mono',monospace",color:T.textMuted}}>{gCount}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grup özet kartları — sadece "Tümü" seçiliyken */}
      {filterGroup==="all" && groupStats.length>0 && (
        <div style={{padding:"12px 20px",borderBottom:`1px solid ${T.border}`,
          display:"flex",gap:10,flexWrap:"wrap"}}>
          {groupStats.map(g=>{
            const c=g.avg?LC[classifyLatency(g.avg)]:T.borderMid;
            return(
              <div key={g.id} onClick={()=>setFilterGroup(g.id)}
                style={{background:T.surface,border:`1px solid ${c}44`,borderRadius:5,
                  padding:"8px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,
                  transition:"border-color 0.2s"}}>
                <span style={{fontSize:16}}>{g.icon}</span>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:T.textPrimary}}>{g.name}</div>
                  <div style={{fontSize:11,fontFamily:"'Share Tech Mono',monospace",color:T.textMuted}}>
                    {g.count} ping · ort {g.avg!==null?`${g.avg}ms`:"—"} · kayıp %{g.loss}
                  </div>
                </div>
                <div style={{marginLeft:4}}>
                  <button onClick={e=>{ e.stopPropagation(); exportCSV(logs.filter(l=>l.groupId===g.id),`ping-log-${g.name}-${new Date().toISOString().slice(0,10)}.csv`); }}
                    style={{background:`${T.accent}11`,border:`1px solid ${T.accent}33`,
                      color:T.accent,fontSize:10,padding:"3px 8px",cursor:"pointer",borderRadius:2,
                      fontFamily:"'Rajdhani',sans-serif",letterSpacing:1}}>⬇</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Kolon başlıkları */}
      <div style={{display:"grid",gridTemplateColumns:"90px 130px 130px 90px 90px 1fr",
        padding:"6px 20px",borderBottom:`1px solid ${T.border}`,
        fontSize:10,letterSpacing:1.5,color:T.textDim,fontFamily:"'Share Tech Mono',monospace"}}>
        <span>SAAT</span><span>GRUP</span><span>HOST</span><span>IP</span><span>SONUÇ</span><span>DURUM</span>
      </div>

      {/* Log satırları */}
      <div style={{flex:1,overflowY:"auto",padding:"4px 0"}}>
        {filtered.length===0?(
          <div style={{textAlign:"center",color:T.textDim,fontSize:14,marginTop:60}}>
            {logs.length===0?"Henüz kayıt yok — ping başlatın":"Bu grup için kayıt yok"}
          </div>
        ):[...filtered].reverse().map((entry,i)=>{
          const c=LC[classifyLatency(entry.ms)];
          const grp=groups.find(g=>g.id===entry.groupId);
          return(
            <div key={i} style={{display:"grid",gridTemplateColumns:"90px 130px 130px 90px 90px 1fr",
              padding:"6px 20px",borderBottom:`1px solid ${T.border}22`,
              background:i%2===0?"transparent":T.rowAlt,
              fontSize:13,fontFamily:"'Share Tech Mono',monospace",alignItems:"center"}}>
              <span style={{color:T.textDim,fontSize:12}}>{fmtTime(entry.ts)}</span>
              <span style={{color:T.textMuted,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {grp?`${grp.icon} ${grp.name}`:"—"}
              </span>
              <span style={{color:T.textSecond,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{entry.label}</span>
              <span style={{color:T.textMuted,fontSize:12}}>{entry.ip}</span>
              <span style={{color:c,fontWeight:700}}>{entry.ms===null?"TIMEOUT":`${entry.ms}ms`}</span>
              <span style={{fontSize:11,background:`${c}22`,color:c,border:`1px solid ${c}44`,
                padding:"1px 8px",borderRadius:2,display:"inline-block",width:"fit-content"}}>
                {LL[classifyLatency(entry.ms)]}
              </span>
            </div>
          );
        })}
        <div ref={endRef}/>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App(){
  const [isDark,setIsDark]=useState(()=>{ try{ return localStorage.getItem("ping_theme")!=="light"; }catch{ return true; } });
  const T=isDark?DARK:LIGHT;

  const [groups,setGroups]=useState(()=>{ try{ const s=localStorage.getItem("ping_groups"); return s?JSON.parse(s):DEFAULT_GROUPS; }catch{ return DEFAULT_GROUPS; } });
  const [logs,setLogs]=useState(()=>{ try{ const s=localStorage.getItem("ping_logs"); return s?JSON.parse(s):[]; }catch{ return []; } });

  const [activeGroup,setActiveGroup]=useState(groups[0]?.id||null);
  const [activeTab,setActiveTab]=useState("dashboard");
  const [pingConfig,setPingConfig]=useState({count:4,packetSize:32});
  const [results,setResults]=useState({});
  const [running,setRunning]=useState({});
  const [editMode,setEditMode]=useState(false);
  const [newGroupName,setNewGroupName]=useState("");
  const [addingHost,setAddingHost]=useState({label:"",ip:""});
  const [showAddGroup,setShowAddGroup]=useState(false);
  const abortRefs=useRef({});

  useEffect(()=>{ try{ localStorage.setItem("ping_groups",JSON.stringify(groups)); }catch{} },[groups]);
  useEffect(()=>{ try{ localStorage.setItem("ping_logs",JSON.stringify(logs.slice(-1000))); }catch{} },[logs]);
  useEffect(()=>{ try{ localStorage.setItem("ping_theme",isDark?"dark":"light"); }catch{} },[isDark]);

  const currentGroup=groups.find(g=>g.id===activeGroup);

  const startPing=useCallback(async(groupId)=>{
    const group=groups.find(g=>g.id===groupId);
    if(!group||running[groupId]) return;
    abortRefs.current[groupId]=false;
    setRunning(r=>({...r,[groupId]:true}));
    const initRes={};
    group.hosts.forEach(h=>{ initRes[h.id]={pings:[],running:true}; });
    setResults(prev=>({...prev,[groupId]:initRes}));
    const count=Math.min(Math.max(parseInt(pingConfig.count)||4,1),20);
    const pSize=Math.min(Math.max(parseInt(pingConfig.packetSize)||32,8),65507);
    for(let i=0;i<count;i++){
      if(abortRefs.current[groupId]) break;
      const pingResults=await Promise.all(group.hosts.map(async host=>{
        let ms;
        if(window.electronAPI){
          const r=await window.electronAPI.ping({ip:host.ip,count:1,packetSize:pSize});
          ms=r.error?null:(r.results[0]??null);
        } else {
          ms=await fakePing(host.ip,pSize);
        }
        return {host,ms};
      }));
      if(abortRefs.current[groupId]) break;
      const ts=Date.now();
      setLogs(prev=>[...prev,...pingResults.map(({host,ms})=>({ts,label:host.label,ip:host.ip,ms,groupId}))]);
      setResults(prev=>{
        const updated={...(prev[groupId]||{})};
        pingResults.forEach(({host,ms})=>{ updated[host.id]={pings:[...(updated[host.id]?.pings||[]),ms],running:true}; });
        return{...prev,[groupId]:updated};
      });
      if(i<count-1) await new Promise(r=>setTimeout(r,900));
    }
    setResults(prev=>{
      const updated={...(prev[groupId]||{})};
      Object.keys(updated).forEach(k=>{ updated[k]={...updated[k],running:false}; });
      return{...prev,[groupId]:updated};
    });
    setRunning(r=>({...r,[groupId]:false}));
  },[groups,pingConfig,running]);

  const stopPing=gid=>{ abortRefs.current[gid]=true; setRunning(r=>({...r,[gid]:false})); };
  const addGroup=()=>{
    if(!newGroupName.trim()) return;
    const id=genId();
    setGroups(g=>[...g,{id,name:newGroupName.trim(),icon:"◈",hosts:[]}]);
    setActiveGroup(id); setNewGroupName(""); setShowAddGroup(false);
  };
  const deleteGroup=id=>{ setGroups(g=>g.filter(x=>x.id!==id)); if(activeGroup===id) setActiveGroup(groups[0]?.id||null); };
  const addHost=()=>{
    if(!addingHost.label.trim()||!addingHost.ip.trim()) return;
    setGroups(g=>g.map(grp=>grp.id===activeGroup?{...grp,hosts:[...grp.hosts,{id:genId(),label:addingHost.label.trim(),ip:addingHost.ip.trim()}]}:grp));
    setAddingHost({label:"",ip:""});
  };
  const deleteHost=hid=>{ setGroups(g=>g.map(grp=>grp.id===activeGroup?{...grp,hosts:grp.hosts.filter(h=>h.id!==hid)}:grp)); };

  const groupResults=results[activeGroup]||{};
  const isRunning=running[activeGroup];

  const getHostStats=hid=>{
    const r=groupResults[hid];
    if(!r||r.pings.length===0) return null;
    const valid=r.pings.filter(p=>p!==null);
    const avg=valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length*10)/10:null;
    return{ avg, min:valid.length?Math.min(...valid):null, max:valid.length?Math.max(...valid):null,
      loss:Math.round((r.pings.filter(p=>p===null).length/r.pings.length)*100),
      pings:r.pings };
  };

  const inp={ background:T.inputBg, border:`1px solid ${T.borderMid}`, color:T.textPrimary,
    padding:"7px 10px", fontSize:14, fontFamily:"'Rajdhani',sans-serif", borderRadius:3, outline:"none", width:"100%" };

  const TOOLS=[
    {id:"dashboard",icon:"◎",label:"Dashboard"},
    {id:"quickping",icon:"⚡",label:"Hızlı Ping"},
    {id:"traceroute",icon:"⇢",label:"Traceroute"},
    {id:"portscan",icon:"⊞",label:"Port Tarama"},
    {id:"dns",icon:"◉",label:"DNS"},
    {id:"subnet",icon:"⊙",label:"Ağ Tarama"},
    {id:"compare",icon:"⇔",label:"Karşılaştır"},
  ];

  return(
    <div style={{fontFamily:"'Rajdhani',sans-serif",background:T.bg,minHeight:"100vh",
      color:T.textPrimary,position:"relative",overflow:"hidden",transition:"background 0.25s,color 0.25s"}}>

      {isDark&&<div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,
        background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,229,160,0.012) 2px,rgba(0,229,160,0.012) 4px)"}}/>}

      {/* HEADER */}
      <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"12px 24px",background:T.headerBg,borderBottom:`1px solid ${T.border}`,
        position:"relative",zIndex:10,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:20}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:22,color:T.accent,filter:`drop-shadow(0 0 6px ${T.accent})`}}>◎</span>
            <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:20,fontWeight:700,letterSpacing:4,color:T.textPrimary}}>NETPING</span>
            <span style={{fontSize:9,letterSpacing:2,background:`${T.accent}22`,color:T.accent,border:`1px solid ${T.accent}44`,padding:"2px 6px",borderRadius:2}}>PRO</span>
          </div>
          <span style={{color:T.accent,fontSize:13}}>● SİSTEM AKTİF</span>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",gap:14}}>
          {activeTab==="dashboard"&&[["PING SAYISI","count"],["PAKET (byte)","packetSize"]].map(([lbl,key])=>(
            <div key={key} style={{display:"flex",flexDirection:"column",gap:3}}>
              <label style={{fontSize:11,letterSpacing:1.5,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace"}}>{lbl}</label>
              <input type="number" value={pingConfig[key]} onChange={e=>setPingConfig(c=>({...c,[key]:e.target.value}))}
                style={{background:T.inputBg,border:`1px solid ${T.borderMid}`,color:T.textPrimary,
                  padding:"5px 8px",width:90,fontSize:15,fontFamily:"'Share Tech Mono',monospace",borderRadius:3,outline:"none"}}/>
            </div>
          ))}
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            <label style={{fontSize:11,letterSpacing:1.5,color:"transparent",fontFamily:"'Share Tech Mono',monospace",userSelect:"none"}}>TEMA</label>
            <button onClick={()=>setIsDark(d=>!d)}
              style={{background:`${T.accent}18`,border:`1px solid ${T.accent}44`,color:T.accent,
                width:38,height:31,borderRadius:4,cursor:"pointer",fontSize:17,
                display:"flex",alignItems:"center",justifyContent:"center"}}>
              {isDark?"☀":"☾"}
            </button>
          </div>
          {activeTab==="dashboard"&&(
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <label style={{fontSize:11,letterSpacing:1.5,color:"transparent",fontFamily:"'Share Tech Mono',monospace",userSelect:"none"}}>DÜZENLE</label>
              <button onClick={()=>setEditMode(e=>!e)}
                style={{background:editMode?`${T.accent}18`:"transparent",
                  border:`1px solid ${editMode?T.accent:T.borderMid}`,
                  color:editMode?T.accent:T.textMuted,
                  padding:"0 16px",height:31,cursor:"pointer",fontSize:13,letterSpacing:1.5,
                  fontFamily:"'Rajdhani',sans-serif",fontWeight:600,borderRadius:3}}>
                {editMode?"✓ BİTTİ":"✎ DÜZENLE"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div style={{display:"flex",height:"calc(100vh - 57px)",position:"relative",zIndex:1}}>
        {/* SIDEBAR */}
        <aside style={{width:220,background:T.sidebarBg,borderRight:`1px solid ${T.border}`,
          padding:"16px 0",overflowY:"auto",flexShrink:0,display:"flex",flexDirection:"column"}}>

          {/* Tool nav */}
          <div style={{fontSize:10,letterSpacing:2.5,color:T.textMuted,padding:"0 16px 10px",
            fontFamily:"'Share Tech Mono',monospace",borderBottom:`1px solid ${T.border}`,marginBottom:8}}>
            ARAÇLAR
          </div>
          {TOOLS.filter(t=>t.id!=="dashboard").map(tool=>{
            const isAct=activeTab===tool.id;
            return(
              <div key={tool.id} style={{padding:"0 8px"}}>
                <button onClick={()=>setActiveTab(tool.id)}
                  style={{display:"flex",alignItems:"center",gap:9,width:"100%",
                    padding:"9px 12px",borderRadius:4,border:"none",cursor:"pointer",textAlign:"left",
                    background:isAct?`${T.accent}18`:"transparent",
                    borderLeft:isAct?`2px solid ${T.accent}`:"2px solid transparent",
                    color:isAct?T.accent:T.textSecond,
                    fontSize:14,fontWeight:600,fontFamily:"'Rajdhani',sans-serif"}}>
                  <span style={{fontSize:14,minWidth:18}}>{tool.icon}</span>
                  <span>{tool.label}</span>
                </button>
              </div>
            );
          })}

          {/* Groups */}
          <div style={{fontSize:10,letterSpacing:2.5,color:T.textMuted,padding:"12px 16px 10px",
            fontFamily:"'Share Tech Mono',monospace",borderBottom:`1px solid ${T.border}`,
            borderTop:`1px solid ${T.border}`,marginTop:8}}>
            PING GRUPLARI
          </div>
          {groups.map(g=>{
            const isAct=activeGroup===g.id&&activeTab==="dashboard";
            return(
              <div key={g.id} style={{display:"flex",alignItems:"center",padding:"0 8px"}}>
                <button onClick={()=>{ setActiveGroup(g.id); setActiveTab("dashboard"); }}
                  style={{display:"flex",alignItems:"center",gap:8,width:"100%",
                    padding:"9px 12px",borderRadius:4,border:"none",cursor:"pointer",textAlign:"left",
                    background:isAct?`${T.accent}18`:"transparent",
                    borderLeft:isAct?`2px solid ${T.accent}`:"2px solid transparent",
                    color:isAct?T.accent:T.textSecond,
                    fontSize:14,fontWeight:600,fontFamily:"'Rajdhani',sans-serif"}}>
                  <span style={{fontSize:14}}>{g.icon}</span>
                  <span style={{flex:1}}>{g.name}</span>
                  {running[g.id]&&<span style={{color:T.accent,fontSize:9,animation:"pulse 1s infinite"}}>●</span>}
                  <span style={{background:T.border,color:T.textMuted,fontSize:11,
                    padding:"1px 5px",borderRadius:3,fontFamily:"'Share Tech Mono',monospace"}}>{g.hosts.length}</span>
                </button>
                {editMode&&<button onClick={()=>deleteGroup(g.id)}
                  style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:13,padding:"0 4px"}}>✕</button>}
              </div>
            );
          })}
          {editMode&&(
            <div style={{padding:"10px 8px 0"}}>
              {showAddGroup?(
                <div style={{display:"flex",gap:4}}>
                  <input placeholder="Grup adı..." value={newGroupName}
                    onChange={e=>setNewGroupName(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&addGroup()} autoFocus
                    style={{...inp,padding:"5px 8px",fontSize:13}}/>
                  <button onClick={addGroup} style={{background:`${T.accent}22`,border:`1px solid ${T.accent}44`,
                    color:T.accent,cursor:"pointer",padding:"0 10px",borderRadius:3,fontSize:18}}>+</button>
                </div>
              ):(
                <button onClick={()=>setShowAddGroup(true)}
                  style={{width:"100%",background:"transparent",border:`1px dashed ${T.borderMid}`,
                    color:T.textMuted,padding:"7px",cursor:"pointer",fontSize:12,
                    fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>+ Yeni Grup</button>
              )}
            </div>
          )}

          <div style={{flex:1}}/>

          {/* Log */}
          <div style={{padding:"8px",borderTop:`1px solid ${T.border}`}}>
            <button onClick={()=>setActiveTab(t=>t==="logs"?"dashboard":"logs")}
              style={{display:"flex",alignItems:"center",gap:8,width:"100%",
                padding:"9px 12px",borderRadius:4,border:"none",cursor:"pointer",textAlign:"left",
                background:activeTab==="logs"?`${T.accent}18`:"transparent",
                borderLeft:activeTab==="logs"?`2px solid ${T.accent}`:"2px solid transparent",
                color:activeTab==="logs"?T.accent:T.textSecond,
                fontSize:14,fontWeight:600,fontFamily:"'Rajdhani',sans-serif"}}>
              <span>📋</span><span style={{flex:1}}>Ping Geçmişi</span>
              <span style={{background:T.border,color:T.textMuted,fontSize:11,
                padding:"1px 5px",borderRadius:3,fontFamily:"'Share Tech Mono',monospace"}}>{logs.length}</span>
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <main style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>
          {activeTab==="logs"  ?<LogPanel logs={logs} onClear={(groupId)=>{
            if(groupId==="all") setLogs([]);
            else setLogs(prev=>prev.filter(e=>e.groupId!==groupId));
          }} groups={groups} T={T}/>
          :activeTab==="quickping"  ?<QuickPingPanel T={T}/>
          :activeTab==="traceroute"?<TraceroutePanel T={T}/>
          :activeTab==="portscan"  ?<PortScanPanel T={T}/>
          :activeTab==="dns"       ?<DnsPanel T={T}/>
          :activeTab==="subnet"    ?<SubnetPanel T={T}/>
          :activeTab==="compare"   ?<ComparePanel groups={groups} T={T}/>
          :currentGroup?(
            <div style={{padding:24}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                marginBottom:20,paddingBottom:16,borderBottom:`1px solid ${T.border}`}}>
                <div>
                  <div style={{fontSize:24,fontWeight:700,letterSpacing:2,
                    display:"flex",alignItems:"center",gap:10,color:T.textPrimary}}>
                    <span style={{color:T.accent}}>{currentGroup.icon}</span>{currentGroup.name}
                  </div>
                  <div style={{fontSize:13,color:T.textMuted,letterSpacing:1,marginTop:4,fontFamily:"'Share Tech Mono',monospace"}}>
                    {currentGroup.hosts.length} host · {pingConfig.count} ping · {pingConfig.packetSize}B paket
                  </div>
                </div>
                {isRunning?(
                  <button onClick={()=>stopPing(activeGroup)}
                    style={{background:"#ef444422",border:"1px solid #ef4444",color:"#ef4444",
                      padding:"11px 26px",cursor:"pointer",fontSize:14,fontWeight:700,
                      letterSpacing:2,fontFamily:"'Rajdhani',sans-serif",borderRadius:4}}>■ DURDUR</button>
                ):(
                  <button onClick={()=>startPing(activeGroup)} disabled={!currentGroup.hosts.length}
                    style={{background:`linear-gradient(135deg,${T.accent},#00c87a)`,
                      border:"none",color:"#0a0d14",padding:"11px 26px",cursor:"pointer",fontSize:14,
                      fontWeight:700,letterSpacing:2,fontFamily:"'Rajdhani',sans-serif",borderRadius:4,
                      boxShadow:`0 0 20px ${T.accentGlow}`}}>▶ PING BAŞLAT</button>
                )}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
                {currentGroup.hosts.map(host=>{
                  const stats=getHostStats(host.id);
                  const latCls=stats?classifyLatency(stats.avg):null;
                  const color=latCls?LC[latCls]:T.borderMid;
                  const hostRun=groupResults[host.id]?.running&&isRunning;
                  return(
                    <div key={host.id} style={{background:T.surface,border:`1px solid ${color}55`,
                      borderRadius:6,padding:18,transition:"border-color 0.3s"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                        <div style={{display:"flex",alignItems:"center",gap:12}}>
                          <div style={{width:11,height:11,borderRadius:"50%",background:stats?color:T.borderMid,
                            boxShadow:stats?`0 0 8px ${color}88`:"none",transition:"all 0.3s"}}/>
                          <div>
                            <div style={{fontSize:16,fontWeight:700,color:T.textPrimary}}>{host.label}</div>
                            <div style={{fontSize:13,color:T.textMuted,fontFamily:"'Share Tech Mono',monospace",marginTop:2}}>{host.ip}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          {stats&&<div style={{fontSize:12,letterSpacing:1,border:`1px solid ${color}66`,
                            padding:"3px 10px",borderRadius:2,fontWeight:700,background:`${color}22`,color}}>
                            {LL[latCls]}
                          </div>}
                          {editMode&&<button onClick={()=>deleteHost(host.id)}
                            style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14}}>✕</button>}
                        </div>
                      </div>

                      {stats?(
                        <>
                          <div style={{display:"flex",marginBottom:4}}>
                            {[["ORT",stats.avg!==null?`${stats.avg}ms`:"—",color],
                              ["MIN",stats.min!==null?`${stats.min}ms`:"—",T.textPrimary],
                              ["MAX",stats.max!==null?`${stats.max}ms`:"—",T.textPrimary],
                              ["KAYIP",`%${stats.loss}`,stats.loss>0?"#ef4444":"#00e5a0"],
                            ].map(([l,v,c])=>(
                              <div key={l} style={{flex:1,textAlign:"center",padding:"7px 4px",borderRight:`1px solid ${T.border}`}}>
                                <div style={{fontSize:18,fontWeight:700,fontFamily:"'Share Tech Mono',monospace",color:c}}>{v}</div>
                                <div style={{fontSize:11,letterSpacing:1.5,color:T.textMuted,marginTop:3}}>{l}</div>
                              </div>
                            ))}
                          </div>
                          <PingChart pings={stats.pings} color={color} T={T}/>
                          <JitterPanel pings={stats.pings} color={color} T={T}/>
                        </>
                      ):(
                        <div style={{height:48,display:"flex",alignItems:"center",justifyContent:"center",
                          color:hostRun?T.accent:T.textDim,fontSize:13,letterSpacing:1,
                          background:T.chartBg,borderRadius:3}}>
                          {hostRun?"Ping gönderiliyor...":"Ping başlatılmadı"}
                        </div>
                      )}
                    </div>
                  );
                })}

                {editMode&&(
                  <div style={{background:T.surfaceAlt,border:`1px dashed ${T.borderMid}`,
                    borderRadius:6,padding:18,display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{fontSize:14,color:T.textMuted,fontWeight:600,letterSpacing:1}}>+ Host Ekle</div>
                    <input placeholder="Label (ör: SW-Core-01)" value={addingHost.label}
                      onChange={e=>setAddingHost(h=>({...h,label:e.target.value}))} style={inp}/>
                    <input placeholder="IP Adresi (ör: 192.168.1.1)" value={addingHost.ip}
                      onChange={e=>setAddingHost(h=>({...h,ip:e.target.value}))}
                      onKeyDown={e=>e.key==="Enter"&&addHost()} style={inp}/>
                    <button onClick={addHost} style={{background:`${T.accent}18`,border:`1px solid ${T.accent}44`,
                      color:T.accent,padding:"8px",cursor:"pointer",fontSize:13,fontWeight:700,
                      letterSpacing:2,fontFamily:"'Rajdhani',sans-serif",borderRadius:3}}>EKLE</button>
                  </div>
                )}
              </div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",
              justifyContent:"center",height:"100%",gap:12,color:T.textDim}}>
              <div style={{fontSize:48,color:T.border}}>◎</div>
              <div style={{fontSize:16,letterSpacing:2}}>Sol panelden bir grup seçin</div>
            </div>
          )}
        </main>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input::-webkit-inner-spin-button{-webkit-appearance:none;}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-thumb{background:#2a3050;border-radius:3px;}
        @keyframes pulse{0%,100%{opacity:0.3}50%{opacity:1}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        select option{background:#1a2035;color:#e8eeff;}
      `}</style>
    </div>
  );
}
