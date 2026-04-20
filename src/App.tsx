/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Minimize2, 
  Leaf,
  Cloud,
  Droplets,
  Wind,
  Circle,
  Menu,
  X,
  ChevronRight,
  Sparkles
} from 'lucide-react';

// --- TYPES ---
interface Atmosphere {
  id: string;
  name: string;
  description: string;
  color: number[];
  speed: number;
  zoom: number;
  proximity: number;
  audioUrl: string;
  icon: any;
}

export default function App() {
  // --- REFS ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // --- STATE ---
  const [isStarted, setIsStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [activeAtmosphere, setActiveAtmosphere] = useState<string>('clouds');
  const [audioLevel, setAudioLevel] = useState(0);
  const [breathingPhase, setBreathingPhase] = useState<'Inhale' | 'Exhale' | 'Hold'>('Inhale');
  const [showMenu, setShowMenu] = useState(false);

  const atmospheres: Atmosphere[] = [
    { 
      id: 'clouds', 
      name: 'High Clouds', 
      description: 'Floating through a soft, infinite sky.',
      color: [0.8, 0.9, 1.0], 
      speed: 0.05, 
      zoom: 1.5, 
      proximity: -2.3, 
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      icon: Cloud
    },
    { 
      id: 'forest', 
      name: 'Silent Forest', 
      description: 'Deep morning mist in an ancient woodland.',
      color: [0.4, 0.6, 0.4], 
      speed: 0.1, 
      zoom: 2.1, 
      proximity: -1.4, 
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
      icon: Leaf
    },
    { 
      id: 'ocean', 
      name: 'Deep Sea', 
      description: 'The rhythmic pulse of the underwater world.',
      color: [0.1, 0.4, 0.8], 
      speed: 0.08, 
      zoom: 1.8, 
      proximity: -1.7, 
      audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
      icon: Droplets
    }
  ];

  const currentAtmosphere = useMemo(() => 
    atmospheres.find(a => a.id === activeAtmosphere) || atmospheres[0], 
    [activeAtmosphere]
  );

  // --- BREATHING TIMER ---
  useEffect(() => {
    if (!isStarted) return;
    let isActive = true;
    const cycle = async () => {
      while(isActive) {
        if (!isActive) break;
        setBreathingPhase('Inhale');
        await new Promise(r => setTimeout(r, 4000));
        if (!isActive) break;
        setBreathingPhase('Hold');
        await new Promise(r => setTimeout(r, 2000));
        if (!isActive) break;
        setBreathingPhase('Exhale');
        await new Promise(r => setTimeout(r, 6000));
        if (!isActive) break;
        setBreathingPhase('Hold');
        await new Promise(r => setTimeout(r, 1000));
      }
    };
    cycle();
    return () => { isActive = false; };
  }, [isStarted]);

  // --- AUDIO LOGIC ---
  const startAtmosphere = () => {
    if (audioCtxRef.current) return;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.2, ctx.currentTime);
    masterGain.connect(ctx.destination);
    gainRef.current = masterGain;

    const analyzer = ctx.createAnalyser();
    analyzer.fftSize = 128;
    masterGain.connect(analyzer);
    analyzerRef.current = analyzer;
    dataArrayRef.current = new Uint8Array(analyzer.frequencyBinCount);

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.loop = true;
    audio.src = currentAtmosphere.audioUrl;
    audioRef.current = audio;
    
    const source = ctx.createMediaElementSource(audio);
    source.connect(masterGain);
    
    audio.play().catch(err => console.warn("Playback blocked:", err));
    setIsStarted(true);
  };

  const toggleMute = () => {
    if (!gainRef.current || !audioCtxRef.current) return;
    const target = isMuted ? 0.2 : 0;
    gainRef.current.gain.setTargetAtTime(target, audioCtxRef.current.currentTime, 0.2);
    setIsMuted(!isMuted);
  };

  useEffect(() => {
    if (!isStarted) return;
    let frame: number;
    const update = () => {
      if (analyzerRef.current && dataArrayRef.current) {
        analyzerRef.current.getByteFrequencyData(dataArrayRef.current);
        const avg = dataArrayRef.current.reduce((a, b) => a + b) / dataArrayRef.current.length;
        setAudioLevel(avg / 255);
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [isStarted]);

  // --- WEBGL LOGIC ---
  useEffect(() => {
    if (!canvasRef.current) return;
    const gl = canvasRef.current.getContext('webgl');
    if (!gl) return;

    const vs = `
      attribute vec4 position;
      void main() { gl_Position = position; }
    `;

    const fs = `
      precision highp float;
      uniform float u_time;
      uniform vec2 u_res;
      uniform vec3 u_color;
      uniform float u_speed;
      uniform float u_zoom;
      uniform float u_audio;
      uniform float u_proximity;

      #define STEPS 100
      #define DIST 0.001
      #define MAXD 12.0
      #define ITERS 12

      mat2 rot(float a) {
        float s = sin(a), c = cos(a);
        return mat2(c, -s, s, c);
      }

      float mbulb(vec3 p) {
        vec3 z = p;
        float dr = 1.0;
        float r = 0.0;
        float power = 8.0 + sin(u_time * 0.05) * 1.5;
        
        for (int i = 0; i < ITERS; i++) {
          r = length(z);
          if (r > 2.0) break;
          float theta = acos(z.z / r);
          float phi = atan(z.y, z.x);
          dr = pow(r, power - 1.0) * power * dr + 1.0;
          float zr = pow(r, power);
          theta = theta * power;
          phi = phi * power;
          z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + p;
        }
        return 0.5 * log(r) * r / dr;
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
        
        // Dynamic cam based on music and time
        float slow_time = u_time * u_speed;
        vec3 ro = vec3(0, 0, u_proximity + u_audio * 0.02);
        vec3 rd = normalize(vec3(uv, u_zoom + sin(u_time * 0.2) * 0.05));
        
        ro.xz *= rot(slow_time);
        rd.xz *= rot(slow_time);
        ro.yz *= rot(slow_time * 0.5);
        rd.yz *= rot(slow_time * 0.5);

        float t = 0.0;
        float glow = 0.0;
        bool hit = false;

        for (int i = 0; i < STEPS; i++) {
          vec3 p = ro + rd * t;
          float d = mbulb(p);
          
          glow += 0.01 / (0.05 + d * d);
          
          if (d < DIST) {
            hit = true;
            break;
          }
          if (t > MAXD) break;
          t += d;
        }

        // Extremely soft color mixing
        vec3 skyColor = mix(vec3(0.02, 0.03, 0.05), u_color * 0.1, 0.3);
        vec3 color = skyColor;
        
        // Glow layer
        color += u_color * glow * 0.01;
        
        // Atmosphere layer
        float fog = 1.0 - exp(-t * 0.15);
        color = mix(color, skyColor, fog);

        if (hit) {
          color += u_color * 0.3;
        }

        // Post-processing: Soften
        color = pow(color, vec3(0.45));
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    const createShader = (t: number, s: string) => {
      const sh = gl.createShader(t)!;
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      return sh;
    };

    const prog = gl.createProgram()!;
    gl.attachShader(prog, createShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, createShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,1, 1,1, -1,-1, 1,-1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      time: gl.getUniformLocation(prog, 'u_time'),
      res: gl.getUniformLocation(prog, 'u_res'),
      color: gl.getUniformLocation(prog, 'u_color'),
      speed: gl.getUniformLocation(prog, 'u_speed'),
      zoom: gl.getUniformLocation(prog, 'u_zoom'),
      audio: gl.getUniformLocation(prog, 'u_audio'),
      proximity: gl.getUniformLocation(prog, 'u_proximity')
    };

    const resize = () => {
      if (!canvasRef.current) return;
      canvasRef.current.width = window.innerWidth;
      canvasRef.current.height = window.innerHeight;
      gl.viewport(0, 0, window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', resize);
    resize();

    let ani: number;
    const render = (time: number) => {
      gl.uniform1f(uniforms.time, time * 0.001);
      gl.uniform2f(uniforms.res, canvasRef.current!.width, canvasRef.current!.height);
      gl.uniform3f(uniforms.color, (window as any)._color?.[0] ?? 1, (window as any)._color?.[1] ?? 1, (window as any)._color?.[2] ?? 1);
      gl.uniform1f(uniforms.speed, (window as any)._speed ?? 0.1);
      gl.uniform1f(uniforms.zoom, (window as any)._zoom ?? 1.5);
      gl.uniform1f(uniforms.audio, (window as any)._audio ?? 0);
      gl.uniform1f(uniforms.proximity, (window as any)._proximity ?? -2);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ani = requestAnimationFrame(render);
    };
    ani = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(ani);
    };
  }, []);

  useEffect(() => {
    (window as any)._speed = currentAtmosphere.speed;
    (window as any)._zoom = currentAtmosphere.zoom;
    (window as any)._proximity = currentAtmosphere.proximity;
    (window as any)._color = currentAtmosphere.color;
    (window as any)._audio = audioLevel;
  }, [currentAtmosphere, audioLevel]);

  const selectAtmosphere = (id: string) => {
    const a = atmospheres.find(at => at.id === id)!;
    setActiveAtmosphere(id);
    if (audioRef.current) {
      audioRef.current.src = a.audioUrl;
      audioRef.current.load();
      audioRef.current.play().catch(e => console.warn(e));
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05060a] select-none text-white/90">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* OVERLAY GRAIN */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04] grayscale mix-blend-overlay">
        <svg className="w-full h-full">
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      </div>

      {/* INITIAL LANDING */}
      <AnimatePresence>
        {!isStarted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-xl bg-black/40"
          >
            <div className="max-w-md w-full px-12 text-center space-y-16">
              <motion.div
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 1.2 }}
                className="space-y-6"
              >
                <h1 className="text-5xl font-serif tracking-widest font-light">AETHER</h1>
                <p className="text-white/30 font-sans text-xs uppercase tracking-[0.6em]">Quiet your mind.</p>
              </motion.div>
              
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={startAtmosphere}
                className="px-16 py-5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[10px] uppercase tracking-[0.4em] font-medium hover:bg-white/10 transition-all font-sans"
              >
                Begin Journey
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER HUD */}
      <AnimatePresence>
        {isStarted && !zenMode && (
          <motion.header
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute top-12 left-12 flex items-center gap-6 z-40"
          >
            <button 
              onClick={() => setShowMenu(true)}
              className="p-3 glass rounded-full hover:bg-white/10 transition-colors"
            >
              <Menu size={18} />
            </button>
            <div className="h-4 w-px bg-white/10" />
            <div>
              <p className="text-[10px] font-sans font-light uppercase tracking-[0.4em] text-white/40">{currentAtmosphere.name}</p>
              <p className="text-[9px] font-mono text-white/20 uppercase tracking-widest mt-1">Status: Calm</p>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* BREATHING GUIDE - CENTRAL FOCUS */}
      <AnimatePresence>
        {isStarted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          >
            <div className="relative">
              {/* Outer Ring */}
              <motion.div 
                animate={{ 
                  scale: breathingPhase === 'Inhale' ? 1.4 : breathingPhase === 'Exhale' ? 0.8 : 1,
                  opacity: breathingPhase === 'Hold' ? 0.2 : 0.1
                }}
                transition={{ duration: 4, ease: "easeInOut" }}
                className="w-80 h-80 rounded-full border border-white/20"
              />
              
              {/* Inner Pulsing Core */}
              <motion.div 
                animate={{ 
                  scale: breathingPhase === 'Inhale' ? 1.1 : breathingPhase === 'Exhale' ? 0.9 : 1,
                }}
                transition={{ duration: 4, ease: "easeInOut" }}
                className="absolute inset-0 m-auto w-32 h-32 rounded-full bg-white/5 backdrop-blur-3xl flex items-center justify-center"
              >
                <motion.span 
                  key={breathingPhase}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 0.4, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[9px] font-sans uppercase tracking-[0.4em] font-light"
                >
                  {breathingPhase}
                </motion.span>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SIDE MENU */}
      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setShowMenu(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[45]"
            />
            <motion.div 
              initial={{ x: -400 }}
              animate={{ x: 0 }}
              exit={{ x: -400 }}
              className="absolute left-0 inset-y-0 w-full max-w-[400px] bg-black/60 backdrop-blur-3xl border-r border-white/5 z-50 p-8 md:p-16 flex flex-col justify-center"
            >
              <button 
                onClick={() => setShowMenu(false)}
                className="absolute top-12 left-12 p-3 hover:bg-white/5 rounded-full transition-colors"
              >
                <X size={20} />
              </button>

              <div className="space-y-16">
                <div className="space-y-4">
                  <h2 className="text-3xl font-serif font-light text-white/90">Atmospheres</h2>
                  <p className="text-[10px] uppercase tracking-widest text-white/20">Find your sanctuary</p>
                </div>

                <div className="space-y-6">
                  {atmospheres.map(a => (
                    <button
                      key={a.id}
                      onClick={() => {
                        selectAtmosphere(a.id);
                        setShowMenu(false);
                      }}
                      className={`group w-full flex items-center gap-8 p-6 rounded-3xl transition-all border ${
                        activeAtmosphere === a.id 
                          ? 'bg-white/10 border-white/10' 
                          : 'border-transparent hover:bg-white/5'
                      }`}
                    >
                      <div className={`p-4 rounded-full ${activeAtmosphere === a.id ? 'bg-white/10' : 'bg-white/5'} group-hover:scale-110 transition-transform`}>
                        <a.icon size={20} strokeWidth={1} className={activeAtmosphere === a.id ? 'text-white' : 'text-white/40'} />
                      </div>
                      <div className="text-left flex-1">
                        <h3 className="text-sm font-sans font-medium tracking-wider uppercase">{a.name}</h3>
                        <p className="text-[10px] text-white/30 mt-1">{a.description}</p>
                      </div>
                      {activeAtmosphere === a.id && <Sparkles size={14} className="text-white/40" />}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* FOOTER CONTROLS */}
      <AnimatePresence>
        {isStarted && !zenMode && (
          <motion.footer
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="absolute bottom-12 inset-x-12 flex justify-between items-center z-40"
          >
            <div className="flex gap-4">
              <button 
                onClick={toggleMute}
                className="p-4 glass rounded-full hover:bg-white/10 transition-colors"
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <button 
                onClick={() => setZenMode(true)}
                className="p-4 glass rounded-full hover:bg-white/10 transition-colors flex items-center gap-3 pr-6"
              >
                <Maximize2 size={18} />
                <span className="text-[10px] uppercase tracking-widest font-medium font-sans">Zen</span>
              </button>
            </div>

            <div className="text-right">
              <motion.div 
                animate={{ opacity: [0.2, 0.5, 0.2] }}
                transition={{ duration: 3, repeat: Infinity }}
                className="flex items-center gap-4 justify-end"
              >
                <div className="w-12 h-[1px] bg-white/20" />
                <span className="text-[10px] uppercase tracking-[0.4em] font-light font-sans">Ethereal Radio</span>
              </motion.div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* ZEN EXIT */}
      {zenMode && (
        <motion.button 
          initial={{ opacity: 0 }}
          whileHover={{ opacity: 1 }}
          onClick={() => setZenMode(false)}
          className="absolute top-12 right-12 p-4 bg-white/5 backdrop-blur-xl rounded-full text-white/40 z-[100]"
        >
          <Minimize2 size={20} />
        </motion.button>
      )}
    </div>
  );
}
