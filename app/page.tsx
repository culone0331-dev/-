"use client";

import { useMemo, useState } from "react";

type Tier = "初級" | "中級" | "上級";
type Category = "車検" | "整備" | "車の豆知識" | "車総合";
type Question = { category: Category; tier: Tier; question: string; choices: string[]; answer: number; note: string };

const cars = {
  初級: { name: "ポコ", label: "軽四ビギナー", color: "#47d7a3", speed: 54, handling: 78, body: "compact", strength: "軽量・小柄。市街地コースのコーナーなら無敵か？", weakness: "小ささゆえに、ハイパワーエンジンは積めない。" },
  中級: { name: "ノア", label: "小型・普通車チャレンジャー", color: "#4eb3ff", speed: 70, handling: 66, body: "sedan", strength: "速さと曲がりやすさのバランス型。どのコースでも戦える。", weakness: "飛び抜けた得意コースはない。改造の選び方がカギ。" },
  上級: { name: "レイ", label: "スポーツカーマスター", color: "#ff5b67", speed: 84, handling: 58, body: "sport", strength: "高速コースで本領発揮。最高速を活かして追い抜こう。", weakness: "低速コーナーは苦手。ぶつからない走りが必要。" },
} as const;

const bases: Record<Category, { q: string; a: string; d: string[]; n: string }[]> = {
  車検: [
    { q:"車検で確認する主な目的は？", a:"安全・環境の基準に合っているか", d:["洗車の上手さ","運転の速さ","車内の広さ"], n:"車検は、その時点で安全・環境の基準に合うかを確認します。" },
    { q:"自家用乗用車の初回車検は、新車登録から何年後？", a:"3年後", d:["1年後","2年後","5年後"], n:"自家用乗用車の初回は3年後です。" },
    { q:"2回目以降の自家用乗用車の車検は、通常何年ごと？", a:"2年ごと", d:["半年ごと","1年ごと","4年ごと"], n:"一般的な自家用乗用車は2年ごとです。" },
    { q:"車検証で確認できる情報は？", a:"車検の有効期間", d:["次の給油日","運転者の身長","タイヤの値段"], n:"電子車検証では閲覧アプリで有効期間を確認できます。" },
    { q:"スリップサインが出たタイヤはどうする？", a:"交換を検討し、走行を控える", d:["空気を多く入れる","裏返して使う","そのまま高速道路へ行く"], n:"スリップサインは溝が限界に近い合図です。" },
    { q:"ナンバープレートの文字が読みにくいほど汚れていたら？", a:"きれいにして読める状態にする", d:["ステッカーで隠す","そのままでよい","後ろだけ外す"], n:"ナンバープレートは見やすい状態を保ちます。" },
    { q:"ヘッドライトが片方切れている時、正しい行動は？", a:"早めに交換・点検する", d:["昼なら無視する","ハイビームだけで走る","片方をテープで隠す"], n:"灯火類の不具合は安全に関わります。" },
    { q:"車検を受けたら、次の車検まで点検は不要？", a:"不要ではない", d:["毎日必ず不要","洗車だけ必要","給油だけ必要"], n:"車検は次回までの安全を保証するものではありません。" },
    { q:"点検整備記録簿の役目は？", a:"点検や整備の内容を残す", d:["音楽リストを残す","旅行先を残す","駐車場所を残す"], n:"記録を残すと、車の状態を振り返りやすくなります。" },
    { q:"ウインカーの点滅が極端に速い時に考えられることは？", a:"電球など灯火類の異常", d:["エンジンが強くなった","燃料が増えた","タイヤが新品"], n:"いつもと違う点滅なら点検を受けましょう。" },
    { q:"フロントガラスに大きなひびがある時は？", a:"整備工場に相談する", d:["シールで完全に隠す","水をかける","放置する"], n:"視界や安全性に影響するひびは早めに相談します。" },
    { q:"車検でタイヤについて確認される項目の例は？", a:"溝の深さ", d:["ホイールの色","タイヤのメーカー名","空気のにおい"], n:"溝、傷、摩耗などが安全に関わります。" },
    { q:"排気ガスに関わる装置の役目は？", a:"環境への影響を減らす", d:["音を大きくする","車を広くする","座席を温める"], n:"排気ガスの浄化装置は環境性能に関わります。" },
    { q:"車検の有効期限を過ぎた車を公道で運転してよい？", a:"運転してはいけない", d:["近所ならよい","昼だけよい","ゆっくりならよい"], n:"有効期限は必ず確認しましょう。" },
    { q:"ブレーキランプの確認で役立つ人は？", a:"後ろで点灯を見てくれる人", d:["運転席で目を閉じる人","車内で歌う人","タイヤを回す人"], n:"後方の灯火類は外から確認すると確実です。" },
    { q:"車検前に警告灯が点いていたら？", a:"原因を点検する", d:["黒いテープで隠す","エンジンを止めない","音楽を大きくする"], n:"警告灯は車からの大切な知らせです。" },
    { q:"車検の検査で安全に関係するものは？", a:"ブレーキの効き", d:["芳香剤の香り","座席カバーの柄","カップホルダーの数"], n:"止まる・曲がる・見えるための装置が大切です。" },
    { q:"保安基準に適合するよう車を維持するのは誰の役目？", a:"使用者", d:["信号機","ガソリンスタンドだけ","駐車場だけ"], n:"車の使用者には点検・整備の責任があります。" },
    { q:"ワイパーがガラスをきれいに拭けない時は？", a:"ゴムなどを点検・交換する", d:["雨の日だけ外す","ガラスに紙を貼る","速度を上げる"], n:"雨の日の視界を確保する大切な部品です。" },
    { q:"車検切れを防ぐために有効なことは？", a:"有効期限を早めに確認する", d:["車の色を変える","ラジオを消す","鍵を2本持つ"], n:"車検証や車検証閲覧アプリで確認しましょう。" },
  ],
  整備: [
    {q:"エンジンオイルの主な役目は？",a:"エンジンを滑らかに動かす",d:["タイヤを膨らませる","窓を洗う","ライトを光らせる"],n:"潤滑、冷却、汚れを取る働きがあります。"},
    {q:"タイヤの空気圧が低すぎると？",a:"燃費や走りに悪影響が出る",d:["車が軽くなる","ライトが明るくなる","雨が止む"],n:"空気圧は指定値を目安に点検します。"},
    {q:"ブレーキ液が少ない時は？",a:"早めに整備工場へ相談する",d:["水で満たす","そのまま走る","砂糖を入れる"],n:"ブレーキに関わるため、自己判断で放置しません。"},
    {q:"冷却水が不足すると起こりやすいことは？",a:"エンジンの過熱",d:["タイヤの色落ち","車内のにおい改善","燃料が満タン"],n:"冷却水はエンジンの温度管理に役立ちます。"},
    {q:"バッテリーが弱ると起こりやすいことは？",a:"エンジンがかかりにくい",d:["ブレーキが大きくなる","車幅が狭くなる","ワイパーが長くなる"],n:"始動が弱い時は早めに点検します。"},
    {q:"タイヤに釘が刺さっているのを見つけたら？",a:"無理に抜かず整備店へ相談",d:["すぐ抜く","ハンマーで打つ","高速走行で飛ばす"],n:"空気が急に抜けることがあるため注意します。"},
    {q:"走行中にいつもと違う音がしたら？",a:"安全な場所で確認し相談する",d:["音楽を大きくする","加速する","無視する"],n:"異音は故障の前触れの場合があります。"},
    {q:"ワイパー液が出ない時に見る場所は？",a:"ウォッシャー液の量",d:["燃料の色","ナンバーの文字","シートの位置"],n:"液量やノズルの詰まりなどを確認します。"},
    {q:"エアコンの風が弱い時、まず整備で疑う部品は？",a:"エアコンフィルター",d:["ホイールキャップ","ミラー","シフトノブ"],n:"フィルターの汚れで風量が落ちることがあります。"},
    {q:"タイヤの片側だけ減る原因の例は？",a:"足回りのずれ",d:["ラジオの音量","車内の温度","給油量"],n:"偏った摩耗は点検のサインです。"},
    {q:"ブレーキペダルの踏み心地がいつもと違う時は？",a:"点検を受ける",d:["アクセルを踏む","空気圧だけ見る","洗車する"],n:"日常点検の大切な確認項目です。"},
    {q:"エンジンルームを点検する時に大切なことは？",a:"エンジンが冷えてから行う",d:["走行直後に触る","暗い所で急ぐ","手袋なしで回す"],n:"やけどなどを防ぐため、取扱説明書も確認します。"},
    {q:"指定空気圧はどこで確認しやすい？",a:"運転席ドア周辺などの表示",d:["ナビの地図","ルームミラー","車検証の裏だけ"],n:"車種ごとの表示や取扱説明書を確認します。"},
    {q:"エンジンオイルの交換時期は何を参考にする？",a:"取扱説明書と使用状況",d:["車の色","好きな曜日","気温だけ"],n:"走り方で交換時期が変わることもあります。"},
    {q:"タイヤの溝を確認する印は？",a:"スリップサイン",d:["レインボーライン","ドライブマーク","スターサイン"],n:"溝が減ると雨の日に滑りやすくなります。"},
    {q:"ランプが切れたまま運転すると困ることは？",a:"自分や周りから見えにくくなる",d:["車が速くなる","燃料が増える","音が静かになる"],n:"見える・見られることは安全運転の基本です。"},
    {q:"長期間動かさない車で弱りやすいものは？",a:"バッテリー",d:["ハンドルの色","ナンバーの文字","ドアの大きさ"],n:"ときどき状態確認をしましょう。"},
    {q:"エンジン警告灯が点いた時の優先行動は？",a:"取扱説明書を確認して点検",d:["警告灯を隠す","長距離を走る","空気を抜く"],n:"赤い警告灯などは特に早めの対応が必要です。"},
    {q:"安全な日常点検に入るものは？",a:"タイヤの傷の確認",d:["ボディ色の確認","香りの確認","車内音楽の確認"],n:"傷や異常摩耗がないか目で確認します。"},
    {q:"整備で不安な場合の最も安全な選択は？",a:"プロに相談する",d:["動画だけで判断","放置する","部品を適当に外す"],n:"ブレーキや電気系統は特にプロへ相談しましょう。"},
  ],
  "車の豆知識": [
    {q:"軽自動車のナンバープレートで多い色は？",a:"黄色",d:["青色","紫色","白黒しま模様"],n:"軽自動車は黄色いナンバープレートが目印の一つです。"},
    {q:"車が曲がる時に点けるランプは？",a:"ウインカー",d:["ハザードだけ","室内灯","ブレーキランプ"],n:"進路変更や右左折の合図に使います。"},
    {q:"雨の日に道路が滑りやすくなる理由は？",a:"水でタイヤのグリップが減るから",d:["車が軽くなるから","信号が増えるから","音が消えるから"],n:"速度を控え、車間距離を多めに取ります。"},
    {q:"燃料計の矢印が示すことがあるものは？",a:"給油口のある側",d:["進行方向","駐車場","ワイパーの位置"],n:"車種によって燃料マークの横に矢印があります。"},
    {q:"シートベルトをする主な理由は？",a:"体を守るため",d:["車を速くするため","燃料を増やすため","ライトを消すため"],n:"全席で正しく着用することが大切です。"},
    {q:"ハイブリッド車の特徴の一つは？",a:"エンジンとモーターを使う",d:["羽で飛ぶ","水だけで走る","ペダルがない"],n:"状況によりエンジンとモーターを使い分けます。"},
    {q:"EVとはどんな車？",a:"電気で走る車",d:["水中だけ走る車","翼のある車","タイヤがない車"],n:"EVはElectric Vehicleの略です。"},
    {q:"ABSの役目は？",a:"急ブレーキ時にタイヤがロックしにくくする",d:["車内を冷やす","音楽を流す","燃料を作る"],n:"ABSがあっても、十分な車間距離が必要です。"},
    {q:"チャイルドシートが特に大切なのは？",a:"子どもの体を守るため",d:["荷物を増やすため","車を高くするため","窓を曇らせないため"],n:"年齢・体格に合ったものを正しく使います。"},
    {q:"夜にライトを使う大切な目的は？",a:"前方を見て周囲に知らせる",d:["エンジンを冷やす","タイヤを温める","座席を動かす"],n:"自分が見えるだけでなく、相手に見つけてもらう役目もあります。"},
    {q:"クラクションは主にいつ使う？",a:"危険を防ぐ必要がある時",d:["あいさつだけ","音楽に合わせる時","渋滞の暇つぶし"],n:"むやみに鳴らさず、安全のために使います。"},
    {q:"ミニバンの特徴として近いものは？",a:"人や荷物を多く乗せやすい",d:["必ず2人乗り","屋根がない","タイヤが1本"],n:"家族での移動にも使いやすい車です。"},
    {q:"スポーツカーが得意としやすいことは？",a:"走りの楽しさや運動性能",d:["荷物を100個積むこと","水上走行","必ず燃料不要"],n:"低い姿勢や走りを意識した設計が特徴です。"},
    {q:"メーターにある速度計は何を表す？",a:"今の速さ",d:["燃料の色","車の年齢","運転者の心拍数"],n:"速度は道路の標識や周囲に合わせます。"},
    {q:"ドライブレコーダーの役目は？",a:"走行中の映像を記録する",d:["車を自動修理する","燃料を入れる","タイヤを交換する"],n:"事故やトラブル時の確認に役立つことがあります。"},
    {q:"ボンネットの下にある大切な機械は？",a:"エンジン",d:["テレビ","冷蔵庫","洗濯機"],n:"車を動かす力を作る中心の一つです。"},
    {q:"車の後ろで赤く光るランプは？",a:"ブレーキランプ",d:["ウインカーだけ","室内灯","フォグランプ"],n:"減速・停止を後ろへ伝えます。"},
    {q:"バックミラーで主に確認する方向は？",a:"後ろ",d:["車の下だけ","空だけ","エンジンの中"],n:"周囲の状況を確認するために使います。"},
    {q:"車の「燃費」とは？",a:"燃料でどれくらい走れるかの目安",d:["車の値段","座席の数","色の濃さ"],n:"運転方法や道路状況でも変わります。"},
    {q:"エコドライブに役立つ運転は？",a:"急発進・急加速を控える",d:["必要なく空ぶかし","急ブレーキを増やす","荷物を増やし続ける"],n:"安全にも燃費にもやさしい運転を心がけます。"},
  ],
  車総合: [
    {q:"赤信号で車がすることは？",a:"停止する",d:["加速する","右だけ曲がる","ライトを消す"],n:"信号に従い、安全を確かめます。"},
    {q:"運転前に調整するとよいものは？",a:"シートとミラー",d:["ナンバーの位置","タイヤの色","道路の形"],n:"正しい姿勢と視界は安全運転の基本です。"},
    {q:"横断歩道の近くで気を付けることは？",a:"歩行者がいないか確認する",d:["必ず追い越す","音楽を上げる","急加速する"],n:"歩行者を優先し、いつでも止まれる速度にします。"},
    {q:"運転中にスマホを手で操作してよい？",a:"してはいけない",d:["信号待ち以外ならよい","高速道路ならよい","短時間ならよい"],n:"運転中のながら操作は危険です。"},
    {q:"眠気を感じたらどうする？",a:"安全な場所で休憩する",d:["窓を閉めて我慢","速度を上げる","目を閉じる"],n:"眠気は重大な事故につながります。"},
    {q:"雨の日は晴れの日より車間距離を？",a:"長めに取る",d:["短くする","同じで必ずよい","なくす"],n:"濡れた路面では止まる距離が延びやすくなります。"},
    {q:"発進前に確認したいことは？",a:"周囲に人や障害物がないか",d:["ラジオ局だけ","時計だけ","車の色だけ"],n:"目視とミラーで安全を確認します。"},
    {q:"駐車場で特に注意する相手は？",a:"歩行者や子ども",d:["自分の影だけ","雲だけ","看板だけ"],n:"低速で周囲をよく確認します。"},
    {q:"緊急車両が近づいたら？",a:"進路を譲る",d:["競争する","追いかける","道をふさぐ"],n:"周囲を確認して安全に道を譲ります。"},
    {q:"高速道路で故障した時、まず大切なのは？",a:"安全な場所へ避難する",d:["車内で待つだけ","車道を歩く","急にUターンする"],n:"状況に応じて安全を確保し、助けを呼びます。"},
    {q:"車の死角とは？",a:"運転席から見えにくい場所",d:["車内の明るい場所","給油口の中","ナビの画面"],n:"目視で補い、ゆっくり確認します。"},
    {q:"カーブの手前で大切な運転は？",a:"あらかじめ速度を落とす",d:["カーブ中に急加速","目をそらす","片手を離す"],n:"カーブ前に安全な速度へ落とします。"},
    {q:"追い越しをする時に大切なことは？",a:"安全を十分に確認する",d:["必ず速ければよい","合図はいらない","前だけ見ればよい"],n:"道路状況とルールを守ることが前提です。"},
    {q:"駐車ブレーキの役目は？",a:"駐車中に車が動かないようにする",d:["車を加速する","ライトを消す","エアコンを強くする"],n:"停車後に確実にかけます。"},
    {q:"家族で出かける前、子どもに伝える安全ルールは？",a:"車道側に急に出ない",d:["走行中に立つ","窓から手を出す","ベルトを外す"],n:"乗り降りや車内での安全も大切です。"},
    {q:"後退する時に安全な方法は？",a:"ゆっくり目視でも確認する",d:["ミラーだけで急ぐ","後ろを見ない","クラクションだけ使う"],n:"カメラがあっても目視確認が必要です。"},
    {q:"車内に置かない方がよい物は？",a:"高温で危険になる物",d:["シートベルト","取扱説明書","ティッシュ"],n:"夏の車内は非常に高温になります。"},
    {q:"道路標識を守る理由は？",a:"みんなが安全に通るため",d:["車を大きくするため","燃料を作るため","音を変えるため"],n:"標識は道路の約束です。"},
    {q:"運転中に気分が悪くなったら？",a:"安全な場所に停車する",d:["我慢して走る","目を閉じる","速度を上げる"],n:"無理をしないことが大切です。"},
    {q:"出発前に燃料が少ないと気付いたら？",a:"余裕を持って給油する",d:["警告灯まで待つだけ","水を入れる","窓を開ける"],n:"予定と残量を確認し、早めの給油を心がけます。"},
  ],
};

function makeQuestions(): Question[] {
  const tiers: Tier[] = ["初級", "中級", "上級"];
  const lead: Record<Tier, string> = { 初級: "ポコといっしょに考えよう！", 中級: "ノアのチャレンジ問題。", 上級: "レイのレース知識テスト。" };
  return (Object.keys(bases) as Category[]).flatMap((category) => tiers.flatMap((tier) => bases[category].map((item, index) => {
    const correctSlot = (index + tiers.indexOf(tier)) % 4;
    const choices = [...item.d]; choices.splice(correctSlot, 0, item.a);
    return { category, tier, question: `${lead[tier]} ${item.q}`, choices, answer: correctSlot, note: item.n };
  })));
}

const allQuestions = makeQuestions();
function pickQuiz(tier: Tier) { return (Object.keys(bases) as Category[]).flatMap((c) => allQuestions.filter(q=>q.category===c && q.tier===tier).sort(()=>Math.random()-.5).slice(0,5)).sort(()=>Math.random()-.5); }

export default function Home() {
  const [tier, setTier] = useState<Tier | null>(null); const [challengeTier, setChallengeTier] = useState<Tier>("初級"); const [quiz, setQuiz] = useState<Question[]>([]); const [i, setI] = useState(0); const [score, setScore] = useState(0); const [choice, setChoice] = useState<number | null>(null); const [parts, setParts] = useState({ tires:0, wing:0, ride:0, engine:0 }); const [tickets, setTickets] = useState(0); const [raceCount, setRaceCount] = useState(0); const [transferCode, setTransferCode] = useState(""); const [restoreCode, setRestoreCode] = useState(""); const [saveMessage, setSaveMessage] = useState(""); const [screen,setScreen] = useState<"welcome"|"select"|"garage"|"quiz"|"tune"|"race">("welcome");
  const car = tier ? cars[tier] : null; const tokens = tickets; const stat = car ? {speed:car.speed+parts.engine*8+parts.tires*3+parts.wing*2, handling:car.handling+parts.tires*5+parts.ride*7+parts.wing*2} : {speed:0,handling:0};
  const start=()=>{ setQuiz(pickQuiz(challengeTier));setI(0);setScore(0);setChoice(null);setScreen("quiz"); };
  const answer=(n:number)=>{if(choice!==null)return;setChoice(n);if(n===quiz[i].answer)setScore(s=>s+1)};
  const next=()=>{ if(i===quiz.length-1){setTickets(t=>t+Math.floor(score/5));setScreen("tune");}else{setI(x=>x+1);setChoice(null)}};
  const startRace=()=>{ if(raceCount<3){setRaceCount(c=>c+1);setScreen("race");} };
  const makeCode=()=>Array.from(crypto.getRandomValues(new Uint32Array(10))).map(n=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n%32]).join("");
  const saveGarage=async()=>{const code=transferCode||makeCode();setSaveMessage("保存しています…");try{const response=await fetch("/api/garage-save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code,carTier:tier,parts,tickets,challengeTier})});const data=await response.json();if(!response.ok)throw new Error(data.error);setTransferCode(code);setSaveMessage("このコードを次回来店時に入力してください。");}catch(error){setSaveMessage(error instanceof Error?error.message:"保存に失敗しました。")}};
  const restoreGarage=async()=>{const code=restoreCode.trim().toUpperCase();setSaveMessage("読み込んでいます…");try{const response=await fetch(`/api/garage-save?code=${encodeURIComponent(code)}`);const data=await response.json();if(!response.ok)throw new Error(data.error);const saved=data.save;const savedParts=JSON.parse(saved.partsJson);setTier(saved.carTier as Tier);setChallengeTier(saved.challengeTier as Tier);setParts(savedParts);setTickets(saved.tickets);setRaceCount(0);setTransferCode(code);setSaveMessage("");setScreen("garage");}catch(error){setSaveMessage(error instanceof Error?error.message:"読み込みに失敗しました。")}};
  const race = useMemo(()=>{ const player=stat.speed*.62+stat.handling*.38+Math.random()*12; const rivals=["ミント","サンダー","モモ","ギン"] .map((name,j)=>({name,value:68+j*4+Math.random()*19})); return [{name:car?.name??"あなた",value:player,player:true},...rivals].sort((a,b)=>b.value-a.value);},[screen]);
  if(screen==="welcome") return <main className="app welcome-page"><h1>クイズに答えて<br/>車を育てよう。</h1><button className="primary welcome-start" onClick={()=>setScreen("select")}>スタート →</button></main>;
  if(!tier) return <main className="app select-page"><header><p className="eyebrow">CAR SELECT</p><h1>まず車を<br/>選ぼう。</h1><p>車によって、得意なコースと苦手なことが違うよ。</p></header><section className="choose"><div className="car-grid">{(Object.keys(cars) as Tier[]).map(t=><button key={t} className="car-card detailed" style={{"--car":cars[t].color} as React.CSSProperties} onClick={()=>{setTier(t);setChallengeTier("初級");setParts({tires:0,wing:0,ride:0,engine:0});setTickets(0);setRaceCount(0);setTransferCode("");setSaveMessage("")}}><div className={`car ${cars[t].body}`} style={{"--car":cars[t].color} as React.CSSProperties}><i/><b/></div><strong>{cars[t].name}</strong><small>{cars[t].label}</small><p className="strength">得意：{cars[t].strength}</p><p className="weakness">注意：{cars[t].weakness}</p><em>この車を選ぶ →</em></button>)}</div></section><section className="transfer"><h2>続きからあそぶ</h2><p>前回もらった10文字の引き継ぎコードを入力してください。</p><div><input aria-label="引き継ぎコード" maxLength={10} value={restoreCode} onChange={e=>setRestoreCode(e.target.value.toUpperCase())} placeholder="例：AB2CDE3FGH"/><button className="secondary" onClick={restoreGarage}>引き継ぐ</button></div>{saveMessage&&<p className="save-message">{saveMessage}</p>}</section></main>;
  if(screen==="garage") return <main className="app"><button className="back" onClick={()=>setTier(null)}>← 車を選び直す</button><section className="hero"><div className={`car ${car!.body}`} style={{"--car":car!.color} as React.CSSProperties}><i/><b/></div><div><p className="eyebrow">{car!.label}</p><h1>{car!.name}と<br/>クイズレース！</h1><p>挑戦するクラスを選ぼう。改造した性能は、次のクラスにも引き継がれるよ。</p><div className="class-pick">{(["初級","中級","上級"] as Tier[]).map(t=><button key={t} className={challengeTier===t?"selected":""} onClick={()=>setChallengeTier(t)}>{t}クラス</button>)}</div><button className="primary" onClick={start}>{challengeTier}クラスに挑戦 →</button></div></section><section className="how"><div>① 4択クイズ</div><div>② 車を改造</div><div>③ 好きな時にレース</div></section></main>;
  if(screen==="quiz"){const q=quiz[i]; const ok=choice===q.answer;return <main className="app quiz"><div className="topbar"><span>{q.category}・{challengeTier}</span><b>{i+1} / 20</b><span>正解 {score}問</span></div><div className="progress"><i style={{width:`${((i+(choice!==null?1:0))/20)*100}%`}}/></div><section className="question"><p className="eyebrow">QUESTION {String(i+1).padStart(2,"0")}</p><h2>{q.question}</h2><div className="choices">{q.choices.map((c,n)=><button key={c} className={choice===null?"":n===q.answer?"right":n===choice?"wrong":""} onClick={()=>answer(n)}><b>{["A","B","C","D"][n]}</b>{c}</button>)}</div>{choice!==null&&<div className={`result ${ok?"good":"bad"}`}><strong>{ok?"正解！すごい！":"おしい！次で取り返そう！"}</strong><p>{q.note}</p><button className="primary" onClick={next}>{i===19?"クラス結果へ →":"次の問題へ →"}</button></div>}</section></main>}
  if(screen==="tune") return <main className="app"><header className="tune-head"><p className="eyebrow">{challengeTier} CLASS CLEAR</p><h1>{score} / 20問 正解！</h1><p>改造チケット：<b className="token">{tokens}枚</b>　（5問正解ごとに1枚）</p><p>同じ車で走れるのは、あと <b className="token">{3-raceCount}回</b> です。</p></header><section className="tune"><div className={`car ${car!.body}`} style={{"--car":car!.color,"--low":parts.ride?"6px":"0px"} as React.CSSProperties}><i/><b/>{parts.wing>0&&<u/>}</div><div className="stats"><span>スピード <b>{Math.round(stat.speed)}</b></span><span>コーナー <b>{Math.round(stat.handling)}</b></span></div><div className="parts">{[["tires","スポーツタイヤ","コーナー +5 / 速さ +3"],["wing","リアウイング","コーナー +2 / 速さ +2"],["ride","ローダウン","コーナー +7"],["engine","チューンエンジン","速さ +8"]].map(([k,n,d])=>{const key=k as keyof typeof parts;return <button key={k} disabled={tokens<=0||parts[key]>0} onClick={()=>{setParts(p=>({...p,[key]:1}));setTickets(t=>t-1)}}><b>{parts[key]?"装着ずみ":"チケット1枚"}</b><strong>{n}</strong><small>{d}</small></button>})}</div><div className="next-actions"><button className="primary race-btn" onClick={startRace}>この車でレース開始！ →</button>{challengeTier!=="上級"&&<button className="secondary" onClick={()=>{setChallengeTier(challengeTier==="初級"?"中級":"上級");setScreen("garage")}}>レースをせず次のクラスへ →</button>}<button className="secondary" onClick={()=>setScreen("garage")}>別のクラスを選ぶ</button></div></section></main>;
  const rank=race.findIndex(r=>r.player)+1; return <main className="app race"><header><p className="eyebrow">FINAL RACE {raceCount} / 3</p><h1>{car!.name}、全開！</h1><p>クイズと改造の結果で、レースの順位が決まったよ。</p></header><section className="track"><div className="finish">FINISH</div>{race.map((r,n)=><div key={r.name} className={`lane ${r.player?"player":""}`} style={{"--pos":`${22+n*16}%`} as React.CSSProperties}><span>{n+1}</span><div className={`mini-car ${r.player?car!.body:"sedan"}`} style={r.player?{"--car":car!.color} as React.CSSProperties:{}}/><b>{r.name}</b></div>)}</section><section className="rank-card"><p>今回の結果</p><h2>{rank}位！</h2><strong>{rank===1?"優勝！ピットのヒーローだ！":rank<=3?"表彰台入り！ナイスドライブ！":"次は改造を変えて再挑戦！"}</strong><ol>{race.map((r,n)=><li key={r.name} className={r.player?"me":""}>{n+1}位　{r.name}</li>)}</ol>{raceCount<3?<><p>あと{3-raceCount}回、同じ性能を引き継いで遊べます。</p><button className="primary" onClick={()=>setScreen("garage")}>次のクイズに挑戦する →</button></>:<><p>3回レースを走りました。次回来店用に、引き継ぎコードを発行できます。</p><button className="secondary" onClick={saveGarage}>引き継ぎコードを発行</button>{transferCode&&<div className="code-card"><b>引き継ぎコード</b><strong>{transferCode}</strong><small>次回来店時に、この10文字を入力してください。</small></div>}{saveMessage&&<p className="save-message">{saveMessage}</p>}<button className="primary" onClick={()=>{setTier(null);setScreen("garage")}}>最初からもう一度あそぶ</button></>}</section></main>;
}
