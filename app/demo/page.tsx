"use client";
import { useEffect, useMemo, useState } from "react";

const racers=[
  {name:"ポコ",color:"#50dbad",car:"compact"},
  {name:"ミント",color:"#19aeb6",car:"rally"},
  {name:"サンダー",color:"#ffd04b",car:"muscle"},
  {name:"モモ",color:"#f48abb",car:"van"},
  {name:"ギン",color:"#cbd3dc",car:"gt"},
];

export default function DemoRace(){
  const [seconds,setSeconds]=useState(30); const [running,setRunning]=useState(false);
  useEffect(()=>{if(!running||seconds===0)return;const id=setTimeout(()=>setSeconds(s=>s-1),1000);return()=>clearTimeout(id)},[running,seconds]);
  const positions=useMemo(()=>racers.map((r,i)=>({ ...r, p: seconds===0?[92,88,82,77,72][i]:Math.min(88,7+(30-seconds)*2.65+((i*17+seconds*3)%11))})).sort((a,b)=>b.p-a.p),[seconds]);
  const reset=()=>{setSeconds(30);setRunning(true)};
  return <main className="demo-race"><header><p>DEMO RACE</p><h1>{seconds===0?"FINISH!":running?"レース中！":"30秒レース"}</h1><div className="demo-time">{String(Math.floor(seconds/60)).padStart(2,"0")}:{String(seconds%60).padStart(2,"0")}</div></header><section className="demo-track"><div className="demo-finish">FINISH</div>{positions.map((r,index)=><div className="demo-lane" key={r.name}><span>{index+1}</span><b>{r.name}</b><div className={`demo-car ${r.car}`} style={{"--car":r.color,"--pos":`${r.p}%`} as React.CSSProperties}/></div>)}</section><section className="demo-panel"><strong>{seconds===0?`${positions[0].name}が1位でゴール！`:running?"改造した性能で順位が変わる！":"ボタンを押すとレースが始まるよ"}</strong><button onClick={reset}>{seconds===0?"もう一度見る":"レーススタート"}</button></section></main>
}
