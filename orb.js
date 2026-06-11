class AgentOrb {
    constructor(canvasId) {
        this._canvas = document.getElementById(canvasId);
        if (!this._canvas) return;
        this.ctx = this._canvas.getContext('2d');
        
        // Setup state variables
        this.state = 'idle'; // idle, listening, thinking, speaking
        this.time = 0;
        this.baseRadius = 130;
        this.targetRadius = 130;
        this.particles = [];
        this.pulseAmplitude = 0;
        
        // Colors
        this.colors = {
            idle: ['rgba(99, 102, 241, 0.45)', 'rgba(217, 70, 239, 0.35)', 'rgba(6, 182, 212, 0.25)'],
            listening: ['rgba(6, 182, 212, 0.65)', 'rgba(99, 102, 241, 0.45)', 'rgba(16, 185, 129, 0.3)'],
            thinking: ['rgba(217, 70, 239, 0.6)', 'rgba(99, 102, 241, 0.45)', 'rgba(6, 182, 212, 0.35)'],
            speaking: ['rgba(16, 185, 129, 0.6)', 'rgba(6, 182, 212, 0.45)', 'rgba(99, 102, 241, 0.35)']
        };
        
        // Microphone Audio Analyzer fields
        this.audioCtx = null;
        this.analyser = null;
        this.dataArray = null;
        this.micConnected = false;
        
        // Adjust coordinate system for high-DPI displays
        this.resize();
        window.addEventListener('resize', () => this.resize());
        
        // Initialize interactive elements
        this.mouseX = this._canvas.width / 2;
        this.mouseY = this._canvas.height / 2;
        this.hoverEffect = 0;
        
        this.setupInteractivity();
        
        // Seed initial particles for thinking state
        this.initParticles();
        
        // Start animation loop
        this.animate();
    }
    
    get canvas() {
        return this._canvas;
    }
    
    set canvas(newCanvas) {
        if (!newCanvas) return;
        this._canvas = newCanvas;
        this.ctx = newCanvas.getContext('2d');
        this.setupInteractivity();
    }
    
    setupInteractivity() {
        // Clear old listeners if any, then bind to current canvas
        this._canvas.removeEventListener('mousemove', this.boundMouseMove);
        this._canvas.removeEventListener('mouseleave', this.boundMouseLeave);
        
        this.boundMouseMove = (e) => this.handleMouseMove(e);
        this.boundMouseLeave = () => this.handleMouseLeave();
        
        this._canvas.addEventListener('mousemove', this.boundMouseMove);
        this._canvas.addEventListener('mouseleave', this.boundMouseLeave);
    }
    
    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;
    }
    
    setState(state) {
        if (this.state === state) return;
        this.state = state;
        
        // Transition adjustments
        if (state === 'thinking') {
            this.targetRadius = 100;
        } else if (state === 'listening') {
            this.targetRadius = 140;
        } else if (state === 'speaking') {
            this.targetRadius = 135;
        } else {
            this.targetRadius = 130;
        }
    }
    
    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        this.hoverEffect = Math.min(this.hoverEffect + 0.1, 1);
    }
    
    handleMouseLeave() {
        this.hoverEffect = 0;
    }
    
    initParticles() {
        this.particles = [];
        for (let i = 0; i < 60; i++) {
            this.particles.push({
                angle: Math.random() * Math.PI * 2,
                speed: 0.02 + Math.random() * 0.04,
                distance: 120 + Math.random() * 80,
                targetDistance: 120 + Math.random() * 80,
                size: 1 + Math.random() * 3,
                color: Math.random() > 0.5 ? 'var(--accent-magenta)' : 'var(--accent-cyan)',
                opacity: 0.1 + Math.random() * 0.6
            });
        }
    }
    
    async connectMicrophone() {
        if (this.micConnected) return true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 64;
            
            source.connect(this.analyser);
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.micConnected = true;
            return true;
        } catch (e) {
            console.warn("Microphone access blocked or unavailable, using simulation: ", e);
            this.micConnected = false;
            return false;
        }
    }
    
    getAudioAmplitude() {
        if (!this.micConnected || !this.analyser) {
            // Simulated audio values for listening/speaking if mic is offline
            if (this.state === 'listening') {
                return 5 + Math.sin(this.time * 0.2) * 4 + Math.sin(this.time * 0.8) * 3;
            }
            if (this.state === 'speaking') {
                return 15 + Math.sin(this.time * 0.5) * 12 + Math.cos(this.time * 0.1) * 6;
            }
            return 0;
        }
        
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        return sum / this.dataArray.length; // Average amplitude
    }
    
    // Core animation function
    animate() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.time += 0.05;
        
        // Smooth base radius transitions
        this.baseRadius += (this.targetRadius - this.baseRadius) * 0.1;
        
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        
        // Get reactive amplitude
        const amp = this.getAudioAmplitude();
        this.pulseAmplitude += (amp - this.pulseAmplitude) * 0.15;
        
        if (this.state === 'thinking') {
            this.drawThinkingState(centerX, centerY);
        } else {
            this.drawLiquidBlob(centerX, centerY);
        }
        
        requestAnimationFrame(() => this.animate());
    }
    
    // Drawing standard organic blob
    drawLiquidBlob(cx, cy) {
        const ctx = this.ctx;
        const stateColors = this.colors[this.state] || this.colors.idle;
        
        // Draw 3 layers offset from each other
        for (let layer = 0; layer < 3; layer++) {
            ctx.beginPath();
            
            const numPoints = 120;
            const points = [];
            const layerScale = 1 - layer * 0.12;
            const timeOffset = layer * 3.5;
            const speedModifier = 0.5 + layer * 0.25;
            
            for (let i = 0; i < numPoints; i++) {
                const angle = (i / numPoints) * Math.PI * 2;
                
                // organic shifting math
                let displacement = 0;
                
                if (this.state === 'idle') {
                    displacement = Math.sin(angle * 3 + this.time * 0.8 + timeOffset) * 6 +
                                   Math.cos(angle * 5 - this.time * 0.5 + timeOffset) * 4;
                } else if (this.state === 'listening') {
                    const react = this.pulseAmplitude * 0.5;
                    displacement = Math.sin(angle * 8 + this.time * 1.5 + timeOffset) * react +
                                   Math.cos(angle * 12 + this.time * 2.2 + timeOffset) * (react * 0.5);
                } else if (this.state === 'speaking') {
                    const react = this.pulseAmplitude * 0.8;
                    displacement = Math.sin(angle * 4 + this.time * 1.8 + timeOffset) * (react * 0.7) +
                                   Math.cos(angle * 2 - this.time * 1.1 + timeOffset) * (react * 0.3);
                }
                
                // Add mouse hover attraction/distortion
                if (this.hoverEffect > 0) {
                    const dx = cx + Math.cos(angle) * this.baseRadius - this.mouseX;
                    const dy = cy + Math.sin(angle) * this.baseRadius - this.mouseY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 150) {
                        const force = (150 - dist) * 0.15 * this.hoverEffect;
                        displacement += force;
                    }
                }
                
                const r = (this.baseRadius + displacement) * layerScale;
                const x = cx + Math.cos(angle) * r;
                const y = cy + Math.sin(angle) * r;
                
                points.push({ x, y });
            }
            
            // Draw smooth curve through points
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length; i++) {
                const p0 = points[i];
                const p1 = points[(i + 1) % points.length];
                const xc = (p0.x + p1.x) / 2;
                const yc = (p0.y + p1.y) / 2;
                ctx.quadraticCurveTo(p0.x, p0.y, xc, yc);
            }
            
            ctx.closePath();
            
            // Apply gradient fills
            const gradient = ctx.createRadialGradient(cx, cy, 10, cx, cy, this.baseRadius * layerScale);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
            gradient.addColorStop(0.5, stateColors[layer]);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = gradient;
            ctx.fill();
            
            // Draw subtle glowing contour lines for the outermost layers
            if (layer === 0) {
                ctx.strokeStyle = stateColors[0].replace('0.45', '0.8').replace('0.65', '1.0');
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
    }
    
    // Drawing the thinking vortex core + particles
    drawThinkingState(cx, cy) {
        const ctx = this.ctx;
        
        // Draw spinning internal nucleus
        const gradient = ctx.createRadialGradient(cx, cy, 5, cx, cy, this.baseRadius * 0.7);
        gradient.addColorStop(0, '#fff');
        gradient.addColorStop(0.3, 'rgba(217, 70, 239, 0.5)');
        gradient.addColorStop(0.7, 'rgba(99, 102, 241, 0.2)');
        gradient.addColorStop(1, 'transparent');
        
        ctx.beginPath();
        ctx.arc(cx, cy, this.baseRadius * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Swirling particles
        this.particles.forEach(p => {
            // Update orbits
            p.angle += p.speed;
            
            // Spiral inwards or outwards gently
            p.targetDistance = 90 + Math.sin(this.time * p.speed * 5) * 35;
            p.distance += (p.targetDistance - p.distance) * 0.05;
            
            const px = cx + Math.cos(p.angle) * p.distance;
            const py = cy + Math.sin(p.angle) * p.distance;
            
            // Fade-in/fade-out logic
            const currentOpacity = p.opacity * (0.6 + Math.sin(this.time + p.angle) * 0.4);
            
            ctx.beginPath();
            ctx.arc(px, py, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color === 'var(--accent-magenta)' 
                ? `rgba(217, 70, 239, ${currentOpacity})`
                : `rgba(6, 182, 212, ${currentOpacity})`;
            ctx.shadowColor = p.color === 'var(--accent-magenta)' ? 'var(--accent-magenta)' : 'var(--accent-cyan)';
            ctx.shadowBlur = 4;
            ctx.fill();
            
            // Reset shadows
            ctx.shadowBlur = 0;
        });
    }
}
window.AgentOrb = AgentOrb;
