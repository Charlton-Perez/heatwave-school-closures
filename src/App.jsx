import { useState, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import DATA from "./data/localAuthorities.json";
import {
  LEVELS, PARAM_DEFS, LEARNING_SOURCE, BASELINE_NOTE, defaultParams,
  perEventImpact, annualImpact, singleEventTotals, annualTotals,
  learningYearsEquivalent, careerLearningLoss, decadeLearningLoss,
} from "./model.js";

const LAS  = DATA.localAuthorities;
const META = DATA.meta;

// ── regions (the 9 English regions UKHSA uses for heat-health alerts) ─────────
const REGION_ORDER = ["London","South East","East of England","South West",
  "West Midlands","East Midlands","Yorkshire and The Humber","North West","North East"];
const REGIONS = REGION_ORDER.filter(r=>(META.regions||[]).includes(r));
const REGION_SHORT = {
  "Yorkshire and The Humber":"Yorks & Humber","East of England":"East of England",
  "West Midlands":"W Midlands","East Midlands":"E Midlands","South East":"South East",
  "South West":"South West","North West":"North West","North East":"North East","London":"London",
};
const REGION_LAS = Object.fromEntries(
  REGIONS.map(r=>[r, LAS.filter(l=>l.region===r).map(l=>l.dfeCode)])
);
// Default event footprint: the common serious-heat footprint (south + capital).
const DEFAULT_REGIONS = ["South East","London"];
const DEFAULT_SELECTED = LAS.filter(l=>DEFAULT_REGIONS.includes(l.region)).map(l=>l.dfeCode);

// ── palette / theme (house style) ───────────────────────────────────────────
const C = {
  bg:"#07090f",panel:"#0d1120",border:"#1c2640",text:"#ccd9f0",muted:"#4a6080",
  accent:"#fb923c",amber:"#fbbf24",red:"#f87171",green:"#34d399",teal:"#2dd4bf",
  blue:"#38bdf8",purple:"#a78bfa",
};
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
const evn = n=>{
  if(n==null||isNaN(n))return"—";
  if(n===0)return"0";
  if(n<1)return n.toFixed(2);
  if(n<10)return n.toFixed(1);
  return Math.round(n).toLocaleString();
};
const dp1 = n=>(n==null||isNaN(n))?"—":n.toFixed(1);

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

// ── region selector: which regions are under the red alert (event footprint) ──
function RegionSelector({selected,onChange}){
  const sel=new Set(selected);
  const isActive=r=>REGION_LAS[r].length>0 && REGION_LAS[r].every(c=>sel.has(c));
  const isPartial=r=>!isActive(r) && REGION_LAS[r].some(c=>sel.has(c));
  const toggle=r=>{
    const codes=REGION_LAS[r];
    if(isActive(r)) onChange(selected.filter(c=>!codes.includes(c)));
    else onChange([...new Set([...selected,...codes])]);
  };
  return(
    <div style={{flex:1,minWidth:260}}>
      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6,
        display:"flex",gap:10,alignItems:"center"}}>
        <span>Regions under red alert</span>
        <button onClick={()=>onChange(LAS.map(l=>l.dfeCode))} style={{...miniBtn,padding:"2px 8px",fontSize:10}}>All England</button>
        <button onClick={()=>onChange([])} style={{...miniBtn,padding:"2px 8px",fontSize:10}}>Clear</button>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {REGIONS.map(r=>{
          const on=isActive(r), part=isPartial(r);
          return(
            <button key={r} onClick={()=>toggle(r)} title={`${r} · ${REGION_LAS[r].length} LAs`} style={{
              background:on?C.red:"transparent",
              border:`1px solid ${on?C.red:part?C.amber:C.border}`,
              color:on?"#0a0f1c":part?C.amber:C.muted,
              borderRadius:16,padding:"5px 11px",fontSize:11,cursor:"pointer",
              fontFamily:"inherit",fontWeight:on?600:400,transition:"all .15s",
            }}>{REGION_SHORT[r]||r}{part?" ◐":""}</button>
          );
        })}
      </div>
    </div>
  );
}

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
  const [selected,setSelected]=useState(DEFAULT_SELECTED);
  const [gwl,setGwl]=useState("2");
  const set=(k,v)=>setParams(p=>({...p,[k]:v}));

  const selLAs=useMemo(()=>{
    const s=new Set(selected);
    return LAS.filter(l=>s.has(l.dfeCode));
  },[selected]);

  // Human-readable description of the event footprint (which regions are covered)
  const footprint=useMemo(()=>{
    const s=new Set(selected);
    const full=REGIONS.filter(r=>REGION_LAS[r].length&&REGION_LAS[r].every(c=>s.has(c)));
    const partial=REGIONS.filter(r=>!full.includes(r)&&REGION_LAS[r].some(c=>s.has(c)));
    if(full.length===REGIONS.length) return "all England";
    if(full.length===0&&partial.length===0) return "no regions";
    const parts=full.map(r=>REGION_SHORT[r]||r);
    if(partial.length) parts.push(`part of ${partial.map(r=>REGION_SHORT[r]||r).join(", ")}`);
    return parts.join(" + ");
  },[selected]);

  const single=useMemo(()=>singleEventTotals(selLAs,params),[selLAs,params]);
  const annual=useMemo(()=>annualTotals(selLAs,gwl,params),[selLAs,gwl,params]);

  // per-LA economic impact (single event) for bar chart + table
  const perLA=useMemo(()=>selLAs.map(l=>{
    const e=perEventImpact(l,params);
    const a=annualImpact(l,gwl,params);
    return {name:l.laName,dfeCode:l.dfeCode,schools:l.schools,pupils:l.pupils,
      schoolsClosed:e.schoolsClosed,families:e.familiesAffected,economic:e.economicImpact,
      pupilDays:e.learningDaysLost,amber:a.amberPerYear,annualEconomic:a.annualEconomic};
  }),[selLAs,params,gwl]);

  const topEconomic=useMemo(()=>[...perLA].sort((a,b)=>b.economic-a.economic).slice(0,15),[perLA]);

  // decade impact across all warming levels
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

  // Career and decade learning loss (climate tab)
  const careerLoss=useMemo(()=>
    selLAs.length===0 ? 0 :
    selLAs.reduce((sum,la)=>sum+careerLearningLoss(la,gwl,params),0)/selLAs.length
  ,[selLAs,gwl,params]);

  const decadeLoss=useMemo(()=>
    selLAs.reduce((sum,la)=>sum+decadeLearningLoss(la,gwl,params)*la.pupils,0)
  ,[selLAs,gwl,params]);

  // career loss expressed as fraction of a school year
  const careerYearFraction=careerLoss/params.schoolDaysPerYear;

  const yearsEq=learningYearsEquivalent(single.learningDaysLost,single.pupilsAffected,params.schoolDaysPerYear);
  const baseEconomic=levelSeries.find(l=>l.key==="0.61")?.economic||0;
  const gwlEconomic=levelSeries.find(l=>l.key===gwl)?.economic||0;

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

      {/* Shared closure-parameter + event-footprint bar */}
      <div style={{background:"#090c18",borderBottom:`1px solid ${C.border}`,padding:"14px 28px"}}>
        <div style={{maxWidth:1200,margin:"0 auto",display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"flex",gap:26,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.09em",alignSelf:"center"}}>
              Closure<br/>scenario
            </div>
            <Slider label="Schools closing on red" value={params.schoolClosureFraction} min={0} max={1} step={0.05}
              onChange={v=>set("schoolClosureFraction",v)} fmtVal={v=>`${Math.round(v*100)}%`} color={C.accent} width={220}/>
            <div style={{color:C.muted,fontSize:11,maxWidth:400,lineHeight:1.5}}>
              The main lever. Other assumptions — alert duration, amber→red escalation,
              cost, supervision, family size — sit in <b style={{color:C.text}}>Sources &amp; assumptions</b> at
              the foot of the page.
            </div>
          </div>
          <div style={{display:"flex",gap:20,flexWrap:"wrap",alignItems:"flex-end",
            borderTop:`1px solid ${C.border}`,paddingTop:14}}>
            <RegionSelector selected={selected} onChange={setSelected}/>
            <div style={{alignSelf:"flex-end"}}>
              <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Refine authorities</div>
              <LASelector selected={selected} onChange={setSelected}/>
            </div>
          </div>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"18px 28px"}}>

        {tab==="single"?(
          <SingleTab {...{single,perLA,topEconomic,yearsEq,selLAs,params,footprint}}/>
        ):(
          <ClimateTab {...{decade,levelSeries,gwl,setGwl,baseEconomic,gwlEconomic,selLAs,params,footprint,
            careerLoss,careerYearFraction,decadeLoss}}/>
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
function SingleTab({single,topEconomic,yearsEq,selLAs,params,footprint}){
  const daysLost = params.redAlertDurationDays;
  const yearPct  = (daysLost / params.schoolDaysPerYear * 100).toFixed(1);
  const weeksLost = (daysLost / 5).toFixed(1);

  return(
    <>
      <SectionTitle title="Impact of one red-alert closure event"
        sub={`Red alert over ${footprint} · ${selLAs.length} local authorities · ${Math.round(params.schoolClosureFraction*100)}% of schools closed for ${params.redAlertDurationDays} day${params.redAlertDurationDays>1?"s":""}`}/>

      {/* Economic stat row */}
      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Economic impact</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        <Stat label="Schools closed" value={int(single.schoolsClosed||0)} color={C.accent}/>
        <Stat label="Pupils affected" value={num(single.pupilsAffected||0)} color={C.amber}/>
        <Stat label="Families disrupted" value={num(single.familiesAffected||0)} color={C.teal}
          sub="phase & sibling adjusted"/>
        <Stat label="Economic cost" value={gbp(single.economicImpact||0)} color={C.red}
          sub={`over ${params.redAlertDurationDays} day${params.redAlertDurationDays>1?"s":""}`}/>
      </div>

      {/* Learning stat row */}
      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Learning impact</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        <Stat label="Days of instruction lost per pupil" value={`${daysLost}`} color={C.purple}
          sub="= closure duration; applies to all affected pupils"/>
        <Stat label="As share of school year" value={`${yearPct}%`} color={C.purple}
          sub={`${daysLost}d of ${params.schoolDaysPerYear}d statutory year`}/>
        <Stat label="Total pupil-days lost" value={num(single.learningDaysLost||0)} color={C.purple}
          sub="across selected LAs"/>
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
            <Bullet c={C.red} k="Economic" v={`${gbp(single.economicImpact||0)} in lost working time — valued at the Green Book opportunity cost of a caregiver's day. Families are counted once per household (sibling discount applied) and weighted by phase, so secondary-age pupils attract a lower cost than primary-age.`}/>
            <Bullet c={C.purple} k="Learning" v={`${daysLost} day${daysLost>1?"s":""} of instruction lost per affected pupil — ${yearPct}% of the statutory school year (${weeksLost} week${weeksLost==="1.0"?"":"s"} equivalent). Every affected pupil loses the same number of days regardless of age.`}/>
            <Bullet c={C.teal} k="Households" v={`${num(single.familiesAffected||0)} families need to arrange care — adjusted for multiple children and for the lower supervision need of older secondary pupils.`}/>
          </Panel>
          <Panel style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
            <b style={{color:C.text}}>Supervision discount:</b> Primary-age pupils (R–Y6) and SEND pupils require full caregiver cover (factor 1.0). Y7–9 partial ({Math.round(params.supervisionDiscountKS3*100)}%). Y10–11 low (20%). Sixth form minimal (5%). The economic cost reflects effective family disruption, not raw pupil count.
          </Panel>
        </div>
      </div>
    </>
  );
}

// ── Climate tab ───────────────────────────────────────────────────────────────
function ClimateTab({decade,levelSeries,gwl,setGwl,baseEconomic,gwlEconomic,selLAs,params,footprint,
  careerLoss,careerYearFraction,decadeLoss}){
  const multiplier=baseEconomic>0?gwlEconomic/baseEconomic:null;
  const lvl=LEVELS.find(l=>l.key===gwl);
  return(
    <>
      <SectionTitle title="Impact per decade at a given level of global warming"
        sub={`${footprint} · projected amber-alert frequency × your escalation & closure assumptions, totalled over 10 years`}/>

      <Panel style={{marginBottom:14}}>
        <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Global warming level (above pre-industrial)</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {LEVELS.map(L=>(
            <Seg key={L.key} label={L.label} sub={L.sub} active={gwl===L.key} onClick={()=>setGwl(L.key)} color={LVL_COLOR[L.key]}/>
          ))}
        </div>
        {gwl==="0.61"&&(
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,color:C.muted,fontSize:11,lineHeight:1.55}}>
            {BASELINE_NOTE}
          </div>
        )}
      </Panel>

      {/* Economic stats */}
      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Economic impact · decade</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        <Stat label="Closures per authority / decade" value={evn(decade.eventsPerAuth||0)} color={LVL_COLOR[gwl]} sub={`avg across ${selLAs.length} LAs`}/>
        <Stat label="Economic cost / decade" value={gbp(decade.economic||0)} color={C.red} sub="all selected LAs"/>
        <Stat label="vs recent climate" value={multiplier?`${multiplier.toFixed(1)}×`:"—"} color={C.amber} sub="economic cost multiplier"/>
      </div>

      {/* Learning stats */}
      <div style={{color:C.muted,fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>Learning impact · decade</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        <Stat label="Total pupil-days lost / decade" value={num(decade.learning||0)} color={C.purple}
          sub="across selected LAs"/>
        <Stat label="Closure days per pupil over school career" value={dp1(careerLoss)} color={C.purple}
          sub={`at ${lvl?.label} warming · avg across LAs · 14-yr journey`}/>
        <Stat label="Career loss as share of school year" value={`${(careerYearFraction*100).toFixed(1)}%`} color={C.purple}
          sub={`${dp1(careerLoss)} days of ${params.schoolDaysPerYear}-day year`}/>
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
              <Line type="monotone" dataKey="eventsPerAuth" name="Closures / authority / decade"
                stroke={C.accent} strokeWidth={2.5} dot={{fill:C.accent,r:4}}/>
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel style={{fontSize:12,color:C.muted,lineHeight:1.7}}>
        At <b style={{color:LVL_COLOR[gwl]}}>{lvl?.label}</b> of warming, a typical selected authority would face about
        <b style={{color:C.text}}> {evn(decade.eventsPerAuth||0)}</b> red-alert school closures per decade
        (assuming {Math.round(params.amberToRedFraction*100)}% of amber alerts escalate). Across all {selLAs.length} selected
        authorities that totals <b style={{color:C.red}}>{gbp(decade.economic||0)}</b> in economic cost
        and <b style={{color:C.purple}}>{num(decade.learning||0)} pupil-days</b> of lost learning per decade
        {multiplier?<> — <b style={{color:C.amber}}>{multiplier.toFixed(1)}×</b> the recent-climate cost</>:null}.{" "}
        A pupil completing their full school career (Reception through Year 13) at this warming level would accumulate
        an average of <b style={{color:C.purple}}>{dp1(careerLoss)} closure days</b> — equivalent to{" "}
        <b style={{color:C.purple}}>{(careerYearFraction*100).toFixed(1)}%</b> of a single school year.
      </Panel>
    </>
  );
}

// ── Sources & assumptions panel ──────────────────────────────────────────────
function SourcesPanel({params,set}){
  const rows=Object.entries(PARAM_DEFS).filter(([,d])=>!d.topControl);
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
