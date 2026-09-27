const DEFAULT_API="https://script.google.com/macros/s/AKfycbxnTxfqJpttjxyluyx7At_VqDbVEWYxJ_NqVKyACJNtKfN5hZCp8aGC_1RKMdeqOc9qTg/exec";
const MP_CDN="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";
const FACE_MODEL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let api=localStorage.getItem("k3_api")||DEFAULT_API;
let stream=null,running=false,startTime=0,timerHandle=null,rafId=null,lastResult=null;
let faceLandmarker=null,mpReady=false;
let samples=[],closedSamples=0,blinkCount=0,yawnCount=0,nodCount=0,lastEyeClosed=false,lastMouthOpen=false,lastNoseY=null,lastSampleTime=0;

const $=id=>document.getElementById(id);
$("apiUrl").value=api;

function jsonp(url,timeout=10000){
  return new Promise((resolve,reject)=>{
    const cb="k3cb_"+Date.now()+"_"+Math.random().toString(36).slice(2);
    const s=document.createElement("script"),sep=url.includes("?")?"&":"?";
    const clean=()=>{delete window[cb];s.remove()};
    const to=setTimeout(()=>{clean();reject(Error("Timeout API"))},timeout);
    window[cb]=d=>{clearTimeout(to);clean();resolve(d)};
    s.src=url+sep+"prefix="+cb;
    s.onerror=()=>{clearTimeout(to);clean();reject(Error("API tidak dapat diakses"))};
    document.body.appendChild(s);
  });
}

function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function ear(p,i){return (dist(p[i[1]],p[i[5]])+dist(p[i[2]],p[i[4]]))/(2*dist(p[i[0]],p[i[3]]))}
function mar(p){
  return (dist(p[13],p[14]))/(dist(p[78],p[308])+1e-6);
}

async function loadAI(){
  if(mpReady)return true;
  try{
    $("status").textContent="MEMUAT AI...";
    const vision=await import(MP_CDN);
    const {FaceLandmarker,FilesetResolver}=vision;
    const fileset=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    faceLandmarker=await FaceLandmarker.createFromOptions(fileset,{
      baseOptions:{modelAssetPath:FACE_MODEL,runningMode:"VIDEO",numFaces:1},
      outputFaceBlendshapes:false,
      minFaceDetectionConfidence:0.5,
      minFacePresenceConfidence:0.5,
      minTrackingConfidence:0.5
    });
    mpReady=true;
    $("status").textContent="SIAP";
    return true;
  }catch(e){
    console.error(e);
    $("status").textContent="AI ERROR";
    alert("Model AI wajah gagal dimuat. Pastikan internet aktif, lalu refresh halaman.");
    return false;
  }
}

$("saveApi").onclick=()=>{
  api=$("apiUrl").value.trim();
  localStorage.setItem("k3_api",api);
  $("status").textContent="TERSIMPAN";
};

$("checkBtn").onclick=async()=>{
  const id=$("employeeId").value.trim();
  if(!id)return alert("Masukkan ID Pegawai.");
  $("status").textContent="CEK...";
  try{
    const r=await jsonp(api+"?action=employee&employee_id="+encodeURIComponent(id));
    if(!r.ok||!r.employee){
      $("employeeInfo").textContent="Pegawai tidak ditemukan.";
      $("status").textContent="TIDAK DITEMUKAN";
      return;
    }
    $("employeeInfo").innerHTML="<b>"+r.employee.employee_id+"</b> — "+(r.employee.nama||"")+"<br>"+(r.employee.unit||"");
    $("status").textContent="SIAP";
  }catch(e){
    $("status").textContent="API ERROR";
    alert("Apps Script tidak dapat diakses.");
  }
};

$("startBtn").onclick=async()=>{
  if(!$("employeeId").value.trim())return alert("Cek ID Pegawai dahulu.");
  if(!navigator.mediaDevices?.getUserMedia)return alert("Browser tidak mendukung kamera.");
  if(!(await loadAI()))return;

  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
    $("video").srcObject=stream;
    await $("video").play();

    running=true;startTime=Date.now();samples=[];closedSamples=0;blinkCount=0;yawnCount=0;nodCount=0;
    lastEyeClosed=false;lastMouthOpen=false;lastNoseY=null;lastSampleTime=0;
    $("startBtn").disabled=true;$("stopBtn").disabled=false;$("cameraOverlay").style.display="none";
    $("status").textContent="RUNNING";
    timerHandle=setInterval(tick,200);
    rafId=requestAnimationFrame(analyzeFrame);
  }catch(e){
    console.error(e);
    alert("Kamera gagal dibuka. Izinkan kamera dan gunakan HTTPS.");
  }
};

$("stopBtn").onclick=()=>stop(false);

function tick(){
  const sec=(Date.now()-startTime)/1000;
  $("timer").textContent="00:"+String(Math.min(30,Math.floor(sec))).padStart(2,"0");
  $("progress").style.width=Math.min(100,sec/30*100)+"%";
  if(sec>=30)stop(true);
}

function analyzeFrame(now){
  if(!running||!faceLandmarker)return;
  if(now-lastSampleTime>=100){
    lastSampleTime=now;
    try{
      const res=faceLandmarker.detectForVideo($("video"),now);
      const p=res.faceLandmarks?.[0];
      if(p){
        const left=ear(p,[33,160,158,133,153,144]);
        const right=ear(p,[362,385,387,263,373,380]);
        const avgEar=(left+right)/2;
        const mouth=mar(p);
        const noseY=p[1]?.y??0;

        const eyeClosed=avgEar<0.22;
        const mouthOpen=mouth>0.38;
        if(eyeClosed)closedSamples++;
        if(eyeClosed&&!lastEyeClosed)blinkCount++;
        if(mouthOpen&&!lastMouthOpen)yawnCount++;
        if(lastNoseY!==null && Math.abs(noseY-lastNoseY)>0.055)nodCount++;
        lastEyeClosed=eyeClosed;lastMouthOpen=mouthOpen;lastNoseY=noseY;
        samples.push({ear:avgEar,mouth});
      }
    }catch(e){console.warn("Face analysis:",e)}
  }
  rafId=requestAnimationFrame(analyzeFrame);
}

function calculateScore(){
  const n=samples.length||1;
  const perclos=closedSamples/n;
  const blinkRate=blinkCount/(Math.max(1,(Date.now()-startTime)/60000));
  const duration=Math.min(30,(Date.now()-startTime)/1000);
  const yawnRate=yawnCount/Math.max(1,duration/30);
  const nodRate=nodCount/Math.max(1,duration/30);

  let score=0;
  if(perclos>=0.40)score+=60;
  else if(perclos>=0.25)score+=45;
  else if(perclos>=0.15)score+=30;
  else if(perclos>=0.08)score+=15;

  if(blinkRate>=35)score+=15;
  else if(blinkRate>=25)score+=8;

  if(yawnRate>=3)score+=15;
  else if(yawnRate>=1)score+=8;

  if(nodRate>=8)score+=10;
  else if(nodRate>=4)score+=5;

  score=Math.max(0,Math.min(100,Math.round(score)));
  const level=score<25?"NORMAL":score<45?"FATIGUE":score<65?"DROWSINESS":"HIGH DROWSINESS";
  return {score,level,perclos:+perclos.toFixed(3),blink_count:blinkCount,yawn_count:yawnCount,nod_count:nodCount};
}

function stop(auto){
  if(!running)return;
  running=false;clearInterval(timerHandle);cancelAnimationFrame(rafId);
  if(stream)stream.getTracks().forEach(t=>t.stop());
  $("startBtn").disabled=false;$("stopBtn").disabled=true;$("cameraOverlay").style.display="grid";
  const m=calculateScore();
  lastResult={
    employee_id:$("employeeId").value.trim(),
    score:m.score,level:m.level,duration:+Math.min(30,(Date.now()-startTime)/1000).toFixed(1),
    perclos:m.perclos,blink_count:m.blink_count,yawn_count:m.yawn_count,nod_count:m.nod_count
  };
  $("score").textContent=m.score;
  $("resultBadge").textContent=m.level;
  $("resultText").innerHTML="<p>Skor: <b>"+m.score+"</b></p>"+
    "<p>Durasi: <b>"+lastResult.duration+" detik</b></p>"+
    "<p>PERCLOS: <b>"+(m.perclos*100).toFixed(1)+"%</b> • Kedipan: <b>"+m.blink_count+"</b> • Mulut terbuka: <b>"+m.yawn_count+"</b></p>"+
    "<p>Gerakan kepala: <b>"+m.nod_count+"</b></p>"+
    "<p>Hasil ini adalah screening awal berbasis kamera, bukan diagnosis medis. Tindak lanjuti sesuai prosedur K3L.</p>";
  $("result").classList.remove("hidden");
  $("status").textContent="SELESAI";
}

$("saveBtn").onclick=async()=>{
  if(!lastResult)return;
  $("saveBtn").disabled=true;
  try{
    await fetch(api,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"saveScreening",data:lastResult})});
    $("status").textContent="TERKIRIM";
    alert("Hasil dikirim ke Spreadsheet.");
  }catch(e){
    $("status").textContent="GAGAL";
    alert("Pengiriman gagal.");
  }finally{$("saveBtn").disabled=false}
};

loadAI();
