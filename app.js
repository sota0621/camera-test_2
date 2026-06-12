let peer = null;
let currentStream = null;
let videoElement = null;
let canvasElement = document.getElementById('analysis-canvas');
let ctx = canvasElement.getContext('2d');

let src, dst, hsv, mask, contours, hierarchy;
let isProcessing = false;
let lockCounter = 0;
const REQUIRED_FRAMES = 20; // 安定判定（約0.6秒）
let audioCtx = null;

// 💡 OpenCVが読み込まれたか自動で何度もチェックする安全な関数
function checkOpenCVReady() {
    if (typeof cv !== 'undefined' && cv.Mat) {
        document.getElementById('loading-text').style.display = 'none';
        document.getElementById('setup-buttons').style.display = 'block';
    } else {
        // まだ読み込まれていなければ0.3秒後に再チェック
        setTimeout(checkOpenCVReady, 300);
    }
}
// ページが開いた瞬間にチェックを開始する
window.addEventListener('DOMContentLoaded', checkOpenCVReady);

// ナビゲーション用の電子音
function playBeep(freq, duration) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) { console.log(e); }
}

// 📱 スマホモードの起動
document.getElementById('make-smartphone-btn').addEventListener('click', async () => {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('smartphone-screen').style.display = 'block';
    videoElement = document.getElementById('smartphone-video');

    const randomId = Math.floor(1000 + Math.random() * 9000).toString();
    peer = new Peer(randomId);

    peer.on('open', (id) => {
        document.getElementById('my-id-text').innerText = id;
    });

    try {
        currentStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        videoElement.srcObject = currentStream;
    } catch (err) {
        document.getElementById('phone-status').innerText = "カメラ起動エラー: " + err.message;
    }

    peer.on('call', (call) => {
        call.answer(currentStream);
        document.getElementById('phone-status').innerText = "🟢 パソコンと接続中（映像送信中）";
        playBeep(660, 0.1);
    });
});

// 💻 パソコンモードの起動
document.getElementById('make-pc-btn').addEventListener('click', () => {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('pc-screen').style.display = 'block';
    videoElement = document.getElementById('received-video');
    
    const connectBtn = document.getElementById('connect-btn');
    connectBtn.disabled = true;
    document.getElementById('status-alert').innerText = "🔄 通信サーバーに接続中...";

    peer = new Peer(); 

    // 💡 PC側の準備が正式に完了したらボタンを押せるようにする
    peer.on('open', (id) => {
        connectBtn.disabled = false;
        document.getElementById('status-alert').innerText = "✅ 準備完了。スマホのコードを入力してください";
    });
});

// 💻 パソコン側：スマホへの接続ボタン押下時
document.getElementById('connect-btn').addEventListener('click', () => {
    const targetId = document.getElementById('peer-id-input').value;
    if (!targetId) return alert("接続コードを入力してください");

    document.getElementById('connect-form').style.display = 'none';
    document.getElementById('status-alert').innerText = "🔄 スマホと通信を確立中...";
    
    // 💡 空のストリームだとエラーになるブラウザ対策（1x1のダミー映像トラックを作成）
    const dummyCanvas = document.createElement('canvas');
    dummyCanvas.width = 1; 
    dummyCanvas.height = 1;
    const dummyStream = dummyCanvas.captureStream(1); 

    const call = peer.call(targetId, dummyStream);
    
    call.on('stream', (remoteStream) => {
        videoElement.srcObject = remoteStream;
        
        // 💡 自動再生ブロック対策
        videoElement.muted = true; 
        videoElement.play().catch(err => {
            console.log("自動再生がブロックされました:", err);
        });

        videoElement.onloadedmetadata = () => {
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
            
            src = new cv.Mat(videoElement.videoHeight, videoElement.videoWidth, cv.CV_8UC4);
            dst = new cv.Mat(videoElement.videoHeight, videoElement.videoWidth, cv.CV_8UC4);
            hsv = new cv.Mat();
            mask = new cv.Mat();
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();

            isProcessing = true;
            requestAnimationFrame(processVideo);
        };
    });
});

// 💻 パソコン側：受信映像のリアルタイムOpenCV解析
function processVideo() {
    if (!isProcessing) return;

    ctx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    src.data.set(ctx.getImageData(0, 0, canvasElement.width, canvasElement.height).data);

    cv.GaussianBlur(src, dst, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.cvtColor(dst, hsv, cv.COLOR_RGBA2RGB);
    cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

    let low = cv.matFromArray(3, 1, cv.CV_8U, [35, 70, 60]);
    let high = cv.matFromArray(3, 1, cv.CV_8U, [85, 255, 255]);
    cv.inRange(hsv, low, high, mask);
    low.delete(); high.delete();

    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let validCenters = [];
    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        let perimeter = cv.arcLength(cnt, true);

        if (area > 30 && perimeter > 0) {
            let circularity = (4 * Math.PI * area) / (perimeter * perimeter);
            if (circularity > 0.50) { 
                let M = cv.moments(cnt);
                if (M.m00 !== 0) {
                    validCenters.push({ x: M.m10 / M.m00, y: M.m01 / M.m00 });
                }
            }
        }
        cnt.delete();
    }

    const alertBox = document.getElementById('status-alert');

    if (validCenters.length === 4) {
        lockCounter++;

        validCenters.sort((a, b) => a.y - b.y);
        let topTwo = [validCenters[0], validCenters[1]].sort((a, b) => a.x - b.x);
        let bottomTwo = [validCenters[2], validCenters[3]].sort((a, b) => a.x - b.x);
        const pts = [topTwo[0], topTwo[1], bottomTwo[1], bottomTwo[0]];

        if (lockCounter >= REQUIRED_FRAMES) {
            alertBox.innerText = "🟢 撮影OK！位置固定して録画開始！";
            alertBox.className = "alert-locked";
            ctx.strokeStyle = '#00f5d4';
            ctx.lineWidth = 6;
            if (lockCounter % 20 === 0) playBeep(880, 0.05);
        } else {
            alertBox.innerText = "🟡 検出中... そのまま静止してください";
            alertBox.className = "alert-detecting";
            ctx.strokeStyle = '#fee440';
            ctx.lineWidth = 4;
        }

        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.lineTo(pts[3].x, pts[3].y);
        ctx.closePath();
        ctx.stroke();

    } else {
        lockCounter = 0;
        alertBox.innerText = `🔍 マーカー探索中... (${validCenters.length} / 4個)`;
        alertBox.className = "alert-searching";
    }

    requestAnimationFrame(processVideo);
}
