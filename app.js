// 💻 パソコン側：スマホへの接続ボタン押下時
document.getElementById('connect-btn').addEventListener('click', () => {
    const targetId = document.getElementById('peer-id-input').value;
    if (!targetId) return alert("接続コードを入力してください");

    document.getElementById('connect-form').style.display = 'none';
    document.getElementById('status-alert').innerText = "🔄 接続を確立中...";
    
    // 💡 空のストリームだとエラーになるブラウザ対策（1x1のダミー映像トラックを作成）
    const dummyCanvas = document.createElement('canvas');
    dummyCanvas.width = 1; 
    dummyCanvas.height = 1;
    const dummyStream = dummyCanvas.captureStream(1); 

    // スマホを呼び出す
    const call = peer.call(targetId, dummyStream);
    
    call.on('stream', (remoteStream) => {
        videoElement.srcObject = remoteStream;
        
        // 💡 自動再生ブロック対策
        videoElement.muted = true; 
        videoElement.play().catch(err => {
            console.log("自動再生がブロックされました。画面をクリックしてください:", err);
            document.body.addEventListener('click', () => {
                videoElement.play();
            }, { once: true });
        });

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
}); // ← ★ここの閉じカッコとセミコロンが消えていたのが原因です！
