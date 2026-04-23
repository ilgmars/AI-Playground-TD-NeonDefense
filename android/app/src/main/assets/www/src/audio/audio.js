const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = false;

// Cyberpunk BGM Sequencer
const seq = [
    36, 36, 48, 36, 39, 43, 36, 46, // C minor pentatonic vibe
    36, 36, 48, 36, 39, 43, 36, 46,
    34, 34, 46, 34, 37, 41, 34, 44, // Bb
    34, 34, 46, 34, 37, 41, 34, 44
];

let nextNoteTime = 0;
let currentNote = 0;
let seqTimerID = null;

function midiToFreq(m) {
    if (m === 0) return 0;
    return 440 * Math.pow(2, (m - 69) / 12);
}

function scheduleBGM() {
    if (!soundEnabled) return;
    
    // Calculate speed multiplier based on gameSpeed (if defined)
    // Much smaller difference: 1X -> 1.0, 16X -> 1.2
    let speedMult = 1;
    if (typeof gameSpeed !== 'undefined' && gameSpeed >= 1) {
        speedMult = 1 + (Math.log2(gameSpeed) * 0.05);
    }
    
    let currentTempo = 0.13 / speedMult;
    let bassDur = 0.15 / speedMult;
    let arpDur = 0.1 / speedMult;
    
    while (nextNoteTime < audioCtx.currentTime + 0.1) {
        let note = seq[currentNote];
        if (note !== 0) {
            let freq = midiToFreq(note);
            
            // Bassline
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            
            // Quarter volume (normal was ~0.1, so 0.025)
            gain.gain.setValueAtTime(0.025, nextNoteTime);
            gain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + bassDur);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(nextNoteTime);
            osc.stop(nextNoteTime + bassDur);
            
            // Arpeggio melody on top
            if (currentNote % 2 === 0) {
                const osc2 = audioCtx.createOscillator();
                const gain2 = audioCtx.createGain();
                osc2.type = 'square';
                // Play an octave or two higher, picking notes from pentatonic
                let arpNote = note + 24 + (currentNote % 3 === 0 ? 3 : 7); 
                osc2.frequency.value = midiToFreq(arpNote);
                
                gain2.gain.setValueAtTime(0.015, nextNoteTime);
                gain2.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + arpDur);
                
                osc2.connect(gain2);
                gain2.connect(audioCtx.destination);
                osc2.start(nextNoteTime);
                osc2.stop(nextNoteTime + arpDur);
            }
        }
        
        currentNote = (currentNote + 1) % seq.length;
        nextNoteTime += currentTempo; // dynamic tempo
    }
    
    seqTimerID = requestAnimationFrame(scheduleBGM);
}

function startBGM() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    nextNoteTime = audioCtx.currentTime + 0.1;
    currentNote = 0;
    scheduleBGM();
}

function stopBGM() {
    if (seqTimerID) {
        cancelAnimationFrame(seqTimerID);
        seqTimerID = null;
    }
}

const SoundFX = {
    playTone(freq, type, duration, vol = 0.1, slideFreq = null) {
        if (!soundEnabled) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        vol = vol * 0.5; // Half volume for sound effects
        
        // Dynamically reduce sound effect volume if game speed is high to avoid clipping
        if (typeof gameSpeed !== 'undefined' && gameSpeed > 1) {
            vol = vol / gameSpeed;
        }
        
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
        
        vol = vol * 0.5; // Half volume for sound effects
        
        // Dynamically reduce noise volume if game speed is high
        if (typeof gameSpeed !== 'undefined' && gameSpeed > 1) {
            vol = vol / gameSpeed;
        }
        
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

    shootBasic() { this.playTone(400, 'square', 0.1, 0.02, 200); },
    shootSniper() { this.playTone(200, 'sawtooth', 0.2, 0.03, 50); },
    shootRapid() { this.playTone(600, 'square', 0.05, 0.01, 400); },
    shootLaser() { this.playTone(800, 'sine', 0.1, 0.01, 1200); },
    shootRocket() { this.playNoise(0.2, 0.02); this.playTone(150, 'triangle', 0.2, 0.03, 50); },
    shootElectric() { this.playTone(1000, 'sawtooth', 0.1, 0.01, 2000); },
    shootFlak() { this.playNoise(0.1, 0.02); this.playTone(300, 'square', 0.1, 0.02); },
    
    siren() {
        // Disabled per user request
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
        if (soundEnabled) {
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            startBGM();
        } else {
            stopBGM();
        }
        return soundEnabled;
    }
};
