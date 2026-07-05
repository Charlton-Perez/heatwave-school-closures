import { useState, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import DATA from "./data/localAuthorities.json";
import {
  LEVELS, PARAM_DEFS, LEARNING_SOURCE, defaultParams,
  perEventImpact, annualImpact, singleEventTotals, annualTotals,
  learningYearsEquivalent,
} from "./model.js";

const LAS = DATA.localAuthorities;
const META = DATA.meta;

// ── palette / theme (house style) ───────────────────────────────────────────
const C = {
  bg:"#07090f",panel:"#0d1120",border:"#1c2640",text:"#ccd9f0",muted:"#4a6080",
  accent:"#fb923c",amber:"#fbbf24",red:"#f87171",green:"#34d399",teal:"#2dd4bf",
  blue:"#38bdf8",purple:"#a78bfa",
};
// warming-level colours (cool → hot)
const LVL_COLOR = {"0.61":"#38bdf8","1.5":"#fbbf24","2":"#fb923c","3":"#f87171","4":"#dc2626"};
const PAL = ["#fb923c","#f87171","#fbbf24","#38bdf8","#a78bfa","#34d399","#2dd4bf",
             "#e879f9","#60a5fa","#f472b6","#a3e635","#facc15","#818cf8","#4ade80"];

// ── formatters ───────────────────────────────────────────────────────────────
const gbp = n=>{
  if(n==null||isNaN(n))return"—";
  const s=n<0?"-":""; n=Math.abs(n);
  if(n>=1e9)return`${s}£${(n/1e9).toFixed(2)}bn`;
  if(n>=1e6)return`${s}£${(n/1e6).toFixed(1)}m`;
  if(n>=1e3)return`${s}£${(n/1e3).toFixed(0)}k`;
  return`${s}£${Math.round(n)}`;
};
const num = n=>{
  if(n==null||isNaN(n))return"—";
  if(n>=1e6)return`${(n/1e6).toFixed(2)}m`;
  if(n>=1e3)return`${(n/1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString();
};
const int = n=>Math.round(n).toLocaleString();
// event counts can be small fractions (one small LA) or large (all LAs)
const evn = n=>{
  if(n==null||isNaN(n))return"—";
  if(n===0)return"0";
  if(n<1)return n.toFixed(2);
  if(n<10)return n.toFixed(1);
  return Math.round(n).toLocaleString();
};

// ── little UI atoms ──────────────────────────────────────────────────────────
const Panel=({children,style})=>(
  <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:20,...style}}>
    {children}
  </div>
);
const Seg=({label,active,onClick,color,sub})=>(
  <button onClick={onClick} style={{
    background:active?(color||C.accent):"transparent",
    border:`1px solid ${active?(color||C.accent):C.border}`,
    color:active?"#0a0f1c":C.muted,borderRadius:6,padding:"6px 13px",fontSize:12,
    cursor:"pointer",fontFamily:"inherit",transition:"all .15s",fontWeight:active?600:400,
    display:"flex",flexDirection:"column",alignItems:"center",lineHeight:1.25,
  }}>
    <span>{label}</span>
    {sub&&<span style={{fontSize:9,opacity:.8,marginTop:2}}>{sub}</span>}
  </button>
);
const Stat=({label,value,color=C.accent,sub})=>(
  <Panel style={{textAlign:"center",padding:"16px 12px"}}>
    <div style={{color,fontFamily:"'Space Mono',monospace",fontSize:20,fontWeight:700,lineHeight:1.05}}>{value}</div>
    {sub&&<div style={{color:C.muted,fontSize:10,marginTop:4,fontFamily:"'Space Mono',monospace"}}>{sub}</div>}
    <div style={{color:C.muted,fontSize:10,marginTop:6,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</div>
  </Panel>
);
const Tip=({active,payload,label,fmt})=>{
  if(!active||!payload?.length)return null;
  return(
    <div style={{background:"#0a0f1c",border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px"}}>
      <div style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:6}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||C.accent,fontSize:12}}>
          {p.name}: {(fmt||num)(p.value)}
        </div>
      ))}
    </div>
  );
};

// ── LA multi-select (searchable) ─────────────────────────────────────────────
function LASelector({selected,onChange}){
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState("");
  const sel=new Set(selected);
  const isAll=selected.length===LAS.length;
  const label=isAll?`All ${LAS.length} local authorities`
    :selected.length===0?"None selected"
    :selected.length===1?LAS.find(l=>l.dfeCode===selected[0])?.laName
    :`${selected.length} local authorities`;
  const shown=LAS.filter(l=>l.laName.toLowerCase().includes(q.toLowerCase()));
  const toggle=code=>onChange(sel.has(code)?selected.filter(c=>c!==code):[...selected,code]);

  return(
    <div style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        background:C.panel,border:`1px solid ${open?C.accent:C.border}`,borderRadius:8,
        padding:"9px 14px",color:C.text,fontSize:13,cursor:"pointer",fontFamily:"inherit",
        display:"flex",alignItems:"center",gap:10,minWidth:240,justifyContent:"space-between",
      }}>
        <span style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
        <span style={{color:C.muted,fontSize:10}}>{open?"▲":"▼"}</span>
      </button>
      {open&&(
        <>
          <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:50}}/>
          <div style={{
            position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:60,
            background:"#0b1020",border:`1px solid ${C.border}`,borderRadius:10,
            padding:10,width:320,boxShadow:"0 12px 32px #000000aa",
          }}>
            <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search local authority…"
              style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:7,
                padding:"7px 10px",color:C.text,fontSize:12,fontFamily:"inherit",marginBottom:8}}/>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              <button onClick={()=>onChange(LAS.map(l=>l.dfeCode))} style={miniBtn}>Select all</button>
              <button onClick={()=>onChange([])} style={miniBtn}>Clear</button>
              <span style={{marginLeft:"auto",color:C.muted,fontSize:11,alignSelf:"center"}}>{selected.length} selected</span>
            </div>
            <div style={{maxHeight:300,overflowY:"auto"}}>
              {shown.map(l=>{
                const on=sel.has(l.dfeCode);
                return(
                  <div key={l.dfeCode} onClick={()=>toggle(l.dfeCode)} style={{
                    display:"flex",alignItems:"center",gap:9,padding:"6px 8px",borderRadius:6,
                    cursor:"pointer",background:on?"#16233f":"transparent",
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background="#16233f"}
                  onMouseLeave={e=>e.currentTarget.style.background=on?"#16233f":"transparent"}>
                    <span style={{width:14,height:14,borderRadius:4,flexShrink:0,
                      border:`1px solid ${on?C.accent:C.muted}`,background:on?C.accent:"transparent",
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#0a0f1c"}}>{on?"✓":""}</span>
                    <span style={{color:C.text,fontSize:12,flex:1}}>{l.laName}</span>
                    <span style={{color:C.muted,fontSize:10,fontFamily:"'Space Mono',monospace"}}>{num(l.pupils)}</span>
                  </div>
                );
              })}
              {shown.length===0&&<div style={{color:C.muted,fontSize:12,padding:10,textAlign:"center"}}>No match</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
const miniBtn={background:"transparent",border:`1px solid ${C.border}`,borderRadius:6,
  padding:"5px 10px",color:C.muted,fontSize:11,cursor:"pointer",fontFamily:"inherit"};

// ── slider control ───────────────────────────────────────────────────────────
function Slider({label,value,onChange,min,max,step,fmtVal,color=C.accent,width=150}){
  return(
    <div>
      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{label}</div>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(+e.target.value)} style={{accentColor:color,width}}/>
        <span style={{color:C.text,fontFamily:"'Space Mono',monospace",fontSize:14,minWidth:52,textAlign:"right"}}>{fmtVal(value)}</span>
      </div>
    </div>
  );
}

// ── main app ─────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("single");
  const [params,setParams]=useState(defaultParams());
  const [selected,setSelected]=useState(LAS.map(l=>l.dfeCode));
  const [gwl,setGwl]=useState("2");
  const set=(k,v)=>setParams(p=>({...p,[k]:v}));

  const selLAs=useMemo(()=>{
    const s=new Set(selected);
    return LAS.filter(l=>s.has(l.dfeCode));
  },[selected]);

  const single=useMemo(()=>singleEventTotals(selLAs,params),[selLAs,params]);
  const annual=useMemo(()=>annualTotals(selLAs,gwl,params),[selLAs,gwl,params]);

  // per-LA economic impact (single event) for bar chart + table
  const perLA=useMemo(()=>selLAs.map(l=>{
    const e=perEventImpact(l,params);
    const a=annualImpact(l,gwl,params);
    return {name:l.laName,dfeCode:l.dfeCode,schools:l.schools,pupils:l.pupils,
      schoolsClosed:e.schoolsClosed,economic:e.economicImpact,pupilDays:e.learningDaysLost,
      amber:a.amberPerYear,annualEconomic:a.annualEconomic};
  }),[selLAs,params,gwl]);

  const topEconomic=useMemo(()=>[...perLA].sort((a,b)=>b.economic-a.economic).slice(0,15),[perLA]);

  // impact per DECADE across all warming levels for the selected set.
  // Cost & learning are totals across the selected LAs; the event count is an
  // AVERAGE per authority — summing per-LA event rates would double-count a
  // single heatwave that hits many authorities at once.
  const DECADE=10;
  const nLA=selLAs.length||1;
  const levelSeries=useMemo(()=>LEVELS.map(L=>{
    const t=annualTotals(selLAs,L.key,params);
    return {level:L.label,key:L.key,
      economic:t.annualEconomic*DECADE,
      learning:t.annualLearning*DECADE,
      eventsPerAuth:(t.redEventsPerYear/nLA)*DECADE};
  }),[selLAs,params,nLA]);

  const decade={
    economic:annual.annualEconomic*DECADE,
    learning:annual.annualLearning*DECADE,
    eventsPerAuth:(annual.redEventsPerYear/nLA)*DECADE,
  };
  const yearsEq=learningYearsEquivalent(single.learningDaysLost,single.pupilsAffected,params.schoolDaysPerYear);
  const baseEconomic=levelSeries.find(l=>l.key==="0.61")?.economic||0;
  const gwlEconomic=levelSeries.find(l=>l.key===gwl)?.economic||0;

  const [tableSort,setTableSort]=useState("economic");
  const sortedTable=useMemo(()=>[...perLA].sort((a,b)=>
    tableSort==="name"?a.name.localeCompare(b.name):b[tableSort]-a[tableSort]
  ),[perLA,tableSort]);

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,
      fontFamily:"'IBM Plex Sans',system-ui,sans-serif",paddingBottom:60}}>

      {/* Header */}
      <div style={{background:"#08091a",borderBottom:`1px solid ${C.border}`,padding:"18px 28px"}}>
        <div style={{maxWidth:1200,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <div style={{flex:1,minWidth:280}}>
            <h1 style={{margin:0,fontSize:17,fontWeight:700,color:"#fff",letterSpacing:"-0.02em"}}>
              ☀ Heatwave School Closures · Impact Benchmark
            </h1>
            <p style={{margin:"4px 0 0",color:C.muted,fontSize:11,lineHeight:1.5}}>
              England · {META.laCount} local authorities · schools & pupils from GIAS ({META.giasExtract}) ·
              amber heat-health alert frequency from UK Climate Risk Indicators (uk-cri.org)
            </p>
          </div>
          <div style={{display:"flex",gap:6}}>
            <Seg label="Single event" active={tab==="single"} onClick={()=>setTab("single")}/>
            <Seg label="Climate outlook" active={tab==="climate"} onClick={()=>setTab("climate")} color={C.red}/>
          </div>
        </div>
      </div>

      {/* Shared closure-parameter bar (visible on both tabs) */}
      <div style={{background:"#090c18",borderBottom:`1px solid ${C.border}`,padding:"14px 28px"}}>
        <div style={{maxWidth:1200,margin:"0 auto",display:"flex",gap:26,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.09em",alignSelf:"center"}}>
            Closure<br/>scenario
          </div>
          <Slider label="Red alert duration" value={params.redAlertDurationDays} min={1} max={7} step={1}
            onChange={v=>set("redAlertDurationDays",v)} fmtVal={v=>`${v} day${v>1?"s":""}`} color={C.red}/>
          <Slider label="Schools closing on red" value={params.schoolClosureFraction} min={0} max={1} step={0.05}
            onChange={v=>set("schoolClosureFraction",v)} fmtVal={v=>`${Math.round(v*100)}%`} color={C.accent}/>
          <Slider label="Amber → red escalation" value={params.amberToRedFraction} min={0} max={1} step={0.05}
            onChange={v=>set("amberToRedFraction",v)} fmtVal={v=>`${Math.round(v*100)}%`} color={C.amber}/>
          <div style={{marginLeft:"auto",alignSelf:"center"}}>
            <LASelector selected={selected} onChange={setSelected}/>
          </div>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"18px 28px"}}>

        {tab==="single"?(
          <SingleTab {...{single,perLA,topEconomic,sortedTable,tableSort,setTableSort,yearsEq,selLAs,params}}/>
        ):(
          <ClimateTab {...{decade,levelSeries,gwl,setGwl,baseEconomic,gwlEconomic,selLAs,params}}/>
        )}

        {/* Sources & assumptions */}
        <SourcesPanel params={params} set={set}/>

        <div style={{color:C.muted,fontSize:10,marginTop:18,lineHeight:1.6}}>
          {META.note} Generated {META.generated}. This is an illustrative planning tool, not a forecast.
        </div>
      </div>
    </div>
  );
}

// ── Single-event tab ─────────────────────────────────────────────────────────
function SingleTab({single,topEconomic,sortedTable,tableSort,setTableSort,yearsEq,selLAs,params}){
  return(
    <>
      <SectionTitle title="Impact of one red-alert closure event"
        sub={`${selLAs.length} local authorities · ${Math.round(params.schoolClosureFraction*100)}% of schools closed for ${params.redAlertDurationDays} day${params.redAlertDurationDays>1?"s":""}`}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:14}}>
        <Stat label="Schools closed" value={int(single.schoolsClosed||0)} color={C.accent}/>
        <Stat label="Pupils affected" value={num(single.pupilsAffected||0)} color={C.amber}/>
        <Stat label="Families affected" value={num(single.familiesAffected||0)} color={C.teal}/>
        <Stat label="Economic cost" value={gbp(single.economicImpact||0)} color={C.red} sub={`over ${params.redAlertDurationDays} day${params.redAlertDurationDays>1?"s":""}`}/>
        <Stat label="Learning lost" value={`${num(single.learningDaysLost||0)}`} color={C.purple} sub="pupil-days"/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:12,marginBottom:12}}>
        <Panel>
          <div style={{fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>
            Economic cost by local authority · top 15
          </div>
          {topEconomic.length?(
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={topEconomic} layout="vertical" margin={{top:2,right:24,left:8,bottom:2}}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" horizontal={false}/>
                <XAxis type="number" stroke={C.muted} tick={{fontSize:10,fill:C.muted}} tickFormatter={gbp}/>
                <YAxis type="category" dataKey="name" stroke={C.muted} tick={{fontSize:10,fill:C.muted}} width={130}/>
                <Tooltip content={<Tip fmt={gbp}/>} cursor={{fill:"#ffffff08"}}/>
                <Bar dataKey="economic" name="Economic cost" radius={[0,3,3,0]}>
                  {topEconomic.map((_,i)=><Cell key={i} fill={PAL[i%PAL.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ):<Empty/>}
        </Panel>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Panel>
            <div style={{fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>What this means</div>
            <Bullet c={C.red} k="Economic" v={`${gbp(single.economicImpact||0)} borne by families in lost work / replacement childcare across this single event.`}/>
            <Bullet c={C.purple} k="Learning" v={`${num(single.learningDaysLost||0)} pupil-days of instruction lost — about ${(yearsEq*100).toFixed(2)}% of a school year per affected pupil.`}/>
            <Bullet c={C.teal} k="Households" v={`${num(single.familiesAffected||0)} families need to arrange care for at least ${params.redAlertDurationDays} day${params.redAlertDurationDays>1?"s":""}.`}/>
          </Panel>
          <Panel style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
            A “single event” is one red heat-health alert. Adjust duration and the share of
            schools that close in the bar above; pick which local authorities to include using
            the selector top-right. The climate tab turns this per-event cost into an annual
            total using projected alert frequency.
          </Panel>
        </div>
      </div>

      <Panel>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Per local authority ({sortedTable.length})</div>
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            <span style={{color:C.muted,fontSize:11}}>Sort:</span>
            {[["economic","Cost"],["pupils","Pupils"],["schoolsClosed","Closed"],["name","Name"]].map(([k,l])=>(
              <Seg key={k} label={l} active={tableSort===k} onClick={()=>setTableSort(k)}/>
            ))}
          </div>
        </div>
        <div style={{overflowX:"auto",maxHeight:420,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,background:C.panel}}>
              {["Local authority","Schools","Pupils","Schools closed","Economic cost","Pupil-days lost"].map(h=>(
                <th key={h} style={{color:C.muted,fontWeight:500,textAlign:h==="Local authority"?"left":"right",padding:"6px 10px",whiteSpace:"nowrap",fontSize:11}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sortedTable.map(r=>(
                <tr key={r.dfeCode} style={{borderBottom:`1px solid ${C.border}22`}}>
                  <td style={{padding:"6px 10px",color:C.text}}>{r.name}</td>
                  <td style={{padding:"6px 10px",color:C.muted,textAlign:"right",fontFamily:"'Space Mono',monospace"}}>{int(r.schools)}</td>
                  <td style={{padding:"6px 10px",color:C.muted,textAlign:"right",fontFamily:"'Space Mono',monospace"}}>{int(r.pupils)}</td>
                  <td style={{padding:"6px 10px",color:C.accent,textAlign:"right",fontFamily:"'Space Mono',monospace"}}>{int(r.schoolsClosed)}</td>
                  <td style={{padding:"6px 10px",color:C.red,textAlign:"right",fontFamily:"'Space Mono',monospace"}}>{gbp(r.economic)}</td>
                  <td style={{padding:"6px 10px",color:C.purple,textAlign:"right",fontFamily:"'Space Mono',monospace"}}>{int(r.pupilDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sortedTable.length===0&&<Empty msg="Select at least one local authority"/>}
        </div>
      </Panel>
    </>
  );
}

// ── Climate tab ──────────────────────────────────────────────────────────────
function ClimateTab({decade,levelSeries,gwl,setGwl,baseEconomic,gwlEconomic,selLAs,params}){
  const multiplier=baseEconomic>0?(gwlEconomic/baseEconomic):null;
  const lvl=LEVELS.find(l=>l.key===gwl);
  return(
    <>
      <SectionTitle title="Impact per decade at a given level of global warming"
        sub="Projected amber-alert frequency × your escalation & closure assumptions, totalled over 10 years"/>

      <Panel style={{marginBottom:14}}>
        <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Global warming level (above pre-industrial)</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {LEVELS.map(L=>(
            <Seg key={L.key} label={L.label} sub={L.sub} active={gwl===L.key} onClick={()=>setGwl(L.key)} color={LVL_COLOR[L.key]}/>
          ))}
        </div>
      </Panel>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        <Stat label="Closures per authority / decade" value={evn(decade.eventsPerAuth||0)} color={LVL_COLOR[gwl]} sub={`avg across ${selLAs.length} LAs`}/>
        <Stat label="Economic cost / decade" value={gbp(decade.economic||0)} color={C.red} sub="all selected LAs"/>
        <Stat label="Learning lost / decade" value={num(decade.learning||0)} color={C.purple} sub="pupil-days"/>
        <Stat label="vs recent climate" value={multiplier?`${multiplier.toFixed(1)}×`:"—"} color={C.amber} sub="economic cost"/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:12,marginBottom:12}}>
        <Panel>
          <div style={{fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>
            Economic cost per decade across warming levels
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={levelSeries} margin={{top:5,right:20,left:12,bottom:5}}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
              <XAxis dataKey="level" stroke={C.muted} tick={{fontSize:11,fill:C.muted}}/>
              <YAxis stroke={C.muted} tick={{fontSize:11,fill:C.muted}} tickFormatter={gbp}/>
              <Tooltip content={<Tip fmt={gbp}/>} cursor={{fill:"#ffffff08"}}/>
              <Bar dataKey="economic" name="Economic cost / decade" radius={[3,3,0,0]}>
                {levelSeries.map(l=><Cell key={l.key} fill={LVL_COLOR[l.key]} opacity={l.key===gwl?1:0.5}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel>
          <div style={{fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>
            Red closures per authority · per decade
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={levelSeries} margin={{top:5,right:20,left:6,bottom:5}}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
              <XAxis dataKey="level" stroke={C.muted} tick={{fontSize:11,fill:C.muted}}/>
              <YAxis stroke={C.muted} tick={{fontSize:11,fill:C.muted}}/>
              <Tooltip content={<Tip fmt={evn}/>}/>
              <Line type="monotone" dataKey="eventsPerAuth" name="Closures / authority / decade" stroke={C.accent} strokeWidth={2.5} dot={{fill:C.accent,r:4}}/>
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel style={{fontSize:12,color:C.muted,lineHeight:1.7}}>
        At <b style={{color:LVL_COLOR[gwl]}}>{lvl?.label}</b> of warming, a typical selected authority would face about
        <b style={{color:C.text}}> {evn(decade.eventsPerAuth||0)}</b> red-alert school closures per decade
        (assuming {Math.round(params.amberToRedFraction*100)}% of amber alerts escalate). Across all {selLAs.length} selected
        authorities that totals <b style={{color:C.red}}>{gbp(decade.economic||0)}</b> and <b style={{color:C.purple}}>{num(decade.learning||0)} pupil-days </b>
        of lost learning per decade{multiplier?<> — <b style={{color:C.amber}}>{multiplier.toFixed(1)}×</b> the recent-climate cost</>:null}.
      </Panel>
    </>
  );
}

// ── Sources & assumptions panel ──────────────────────────────────────────────
function SourcesPanel({params,set}){
  const rows=Object.entries(PARAM_DEFS);
  return(
    <Panel style={{marginTop:14}}>
      <div style={{fontSize:12,color:C.muted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>
        Sources & assumptions
      </div>
      <div style={{color:C.muted,fontSize:11,marginBottom:14}}>
        Every figure below is editable. <span style={{color:C.green}}>●</span> evidenced from a published source ·
        <span style={{color:C.amber}}> ●</span> scenario assumption you set.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:14}}>
        {rows.map(([k,d])=>(
          <div key={k} style={{border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px",background:"#0a0e1c"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{color:d.evidenced?C.green:C.amber,fontSize:12}}>●</span>
              <span style={{color:C.text,fontSize:12,fontWeight:600,flex:1}}>{d.label}</span>
              <EditVal k={k} d={d} value={params[k]} set={set}/>
            </div>
            <div style={{color:C.muted,fontSize:11,lineHeight:1.55}}>{d.note}</div>
            {d.source&&(
              <a href={d.source.url} target="_blank" rel="noreferrer"
                style={{color:C.blue,fontSize:11,textDecoration:"none",display:"inline-block",marginTop:7}}>
                {d.source.name} ↗
              </a>
            )}
          </div>
        ))}
      </div>
      <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,fontSize:11,color:C.muted,lineHeight:1.6}}>
        <span style={{color:C.purple}}>●</span> Lost-learning framing: {LEARNING_SOURCE.note}{" "}
        <a href={LEARNING_SOURCE.url} target="_blank" rel="noreferrer" style={{color:C.blue,textDecoration:"none"}}>{LEARNING_SOURCE.name} ↗</a>
        <br/>
        <span style={{color:C.blue}}>Amber alert frequency:</span> UK Climate Risk Indicators — median amber heat-health
        alerts/year, UKCP18 Global HadGEM warming-level scenario (CC-BY, University of Reading / IEA).{" "}
        <a href="https://uk-cri.org" target="_blank" rel="noreferrer" style={{color:C.blue,textDecoration:"none"}}>uk-cri.org ↗</a>
        {"  ·  "}
        <span style={{color:C.blue}}>Schools & pupils:</span> DfE Get Information about Schools.{" "}
        <a href="https://get-information-schools.service.gov.uk" target="_blank" rel="noreferrer" style={{color:C.blue,textDecoration:"none"}}>GIAS ↗</a>
      </div>
    </Panel>
  );
}
function EditVal({k,d,value,set}){
  const disp=d.kind==="percent"?`${Math.round(value*100)}%`
    :d.kind==="gbp"?`£${value}`
    :d.kind==="days"?`${value}`:`${value}`;
  const toModel=v=>d.kind==="percent"?v/100:v;
  const fromModel=v=>d.kind==="percent"?Math.round(v*100):v;
  const step=d.kind==="percent"?1:d.step;
  return(
    <span style={{display:"flex",alignItems:"center",gap:6}}>
      <input type="number" value={fromModel(value)} step={step}
        min={d.kind==="percent"?d.min*100:d.min} max={d.kind==="percent"?d.max*100:d.max}
        onChange={e=>set(k,toModel(+e.target.value))}
        style={{width:64,background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,
          padding:"4px 7px",color:C.text,fontSize:12,fontFamily:"'Space Mono',monospace",textAlign:"right"}}/>
      <span style={{color:C.muted,fontSize:10,minWidth:20}}>{d.kind==="percent"?"%":d.kind==="gbp"?"£":d.kind==="days"?"d":""}</span>
    </span>
  );
}

// ── misc ─────────────────────────────────────────────────────────────────────
const SectionTitle=({title,sub})=>(
  <div style={{marginBottom:14}}>
    <div style={{fontSize:15,fontWeight:600,color:"#fff"}}>{title}</div>
    {sub&&<div style={{color:C.muted,fontSize:12,marginTop:3}}>{sub}</div>}
  </div>
);
const Bullet=({c,k,v})=>(
  <div style={{display:"flex",gap:9,marginBottom:10,fontSize:12,lineHeight:1.5}}>
    <span style={{color:c,fontWeight:700,minWidth:70}}>{k}</span>
    <span style={{color:C.text}}>{v}</span>
  </div>
);
const Empty=({msg="No data"})=>(
  <div style={{color:C.muted,textAlign:"center",padding:"40px 0",fontSize:13}}>{msg}</div>
);
