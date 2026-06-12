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

// OpenCVの読み込み監視
document.getElementById('opencv-src').addEventListener('load', () => {
    document.getElementById('loading-text').style.display = 'none';
    document.getElementById('setup-buttons').style.display = 'block';
});

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

    // ランダムな4桁の接続コードを生成してPeerを初期化
    const randomId = Math.floor(1000 + Math.random() * 9000).toString();
    peer = new Peer(randomId);

    peer.on('open', (id) => {
        document.getElementById('my-id-text').innerText = id;
    });

    // 超広角カメラ（環境・背面）のストリームを取得
    try {
        currentStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        videoElement.srcObject = currentStream;
    } catch (err) {
        document.getElementById('phone-status').innerText = "カメラ起動エラー: " + err.message;
    }

    // パソコンから接続要求（コール）が来たら映像を送信する
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
    
    peer = new Peer(); // PC側は自動割り当てIDでOK
});

// 💻 パソコン側：スマホへの接続ボタン押下時
document.getElementById('connect-btn').addEventListener('click', () => {
    const targetId = document.getElementById('peer-id-input').value;
    if (!targetId) return alert("接続コードを入力してください");

    document.getElementById('connect-form').style.display = 'none';
    
    // ダミーのメディアストリーム（受信用なので空）を投げて相手の映像を要求
    const call = peer.call(targetId, new MediaStream());
    
    call.on('stream', (remoteStream) => {
        videoElement.srcObject = remoteStream;
        videoElement.play();

        videoElement.onloadedmetadata = () => {
            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
            
            // OpenCVのメモリ初期化
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

    // 黄緑色の色抽出マスク（環境によって適宜数値を調整）
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

    // 4点検知の判定ロジック
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
            if (lockCounter % 20 === 0) playBeep(880, 0.05); // 定期的な確定音
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
