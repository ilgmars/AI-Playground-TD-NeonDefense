const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = false;

const SoundFX = {
    playTone(freq, type, duration, vol = 0.1, slideFreq = null) {
        if (!soundEnabled) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = type;
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(freq, now);
        if (slideFreq) {
            osc.frequency.exponentialRampToValueAtTime(slideFreq, now + duration);
        }
        
        gainNode.gain.setValueAtTime(vol, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);
        
        osc.start(now);
        osc.stop(now + duration);
    },
    
    playNoise(duration, vol = 0.1) {
        if (!soundEnabled) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const bufferSize = audioCtx.sampleRate * duration; 
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0); 
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1000;
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        noise.start();
    },

    shootBasic() { this.playTone(400, 'square', 0.1, 0.05, 200); },
    shootSniper() { this.playTone(200, 'sawtooth', 0.2, 0.1, 50); },
    shootRapid() { this.playTone(600, 'square', 0.05, 0.03, 400); },
    shootLaser() { this.playTone(800, 'sine', 0.1, 0.02, 1200); },
    shootRocket() { this.playNoise(0.2, 0.05); this.playTone(150, 'triangle', 0.2, 0.08, 50); },
    shootElectric() { this.playTone(1000, 'sawtooth', 0.1, 0.03, 2000); },
    shootFlak() { this.playNoise(0.1, 0.05); this.playTone(300, 'square', 0.1, 0.05); },
    
    siren() {
        if (!soundEnabled) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;
        for (let i = 0; i < 3; i++) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, now + i*1.5);
            osc.frequency.linearRampToValueAtTime(800, now + i*1.5 + 0.7);
            osc.frequency.linearRampToValueAtTime(400, now + i*1.5 + 1.5);
            
            gain.gain.setValueAtTime(0.1, now + i*1.5);
            gain.gain.setValueAtTime(0.1, now + i*1.5 + 1.2);
            gain.gain.linearRampToValueAtTime(0, now + i*1.5 + 1.5);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + i*1.5);
            osc.stop(now + i*1.5 + 1.5);
        }
    },
    
    explosion() { this.playNoise(0.4, 0.1); },
    hit() { this.playNoise(0.1, 0.05); },
    
    build() { this.playTone(300, 'square', 0.1, 0.05, 600); },
    upgrade() { 
        this.playTone(400, 'sine', 0.1, 0.05, 600); 
        setTimeout(() => { if(soundEnabled) this.playTone(600, 'sine', 0.1, 0.05, 800); }, 100);
    },
    error() { this.playTone(150, 'sawtooth', 0.2, 0.05, 100); },
    
    toggle() {
        soundEnabled = !soundEnabled;
        if (soundEnabled && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return soundEnabled;
    }
};
