class Envelope {
    /**
     * 包络
     * @param {EnvelopeTrack[]} tracks 轨道
     * @param {Object} options 选项
     * @param {Boolean} options.loop 循环包络
     * @param {Number} options.cacheResolution 缓存分辨率
     */
    constructor(tracks = [], options = {}) {
        this.options = {
            loop: false,
            cacheResolution: 0,
            ...options
        };

        this.trackNames = [];
        this.tracks = [];

        this.cache = null;
        this.cacheStart = 0;
        this.cacheEnd = 0;
        this.cacheStep = 0;
        this.cacheSize = 0;

        this.result = Object.create(null);

        if (tracks.length) {
            this.setTracks(tracks);
        }
    }

    setTracks(tracksInput) {
        this.trackNames.length = 0;
        this.tracks.length = 0;

        for (const t of tracksInput) {
            const keyframes = (t.keyframe || [])
                .map(k => ({
                    time: Number(k.time),
                    value: k.value,
                    timing_function: k.timing_function ?? "none"
                }))
                .sort((a, b) => a.time - b.time);

            if (keyframes.length === 0) continue;

            const n = keyframes.length;

            const times = new Float64Array(n);
            const values = new Float64Array(n);
            const easing = new Array(n);

            for (let i = 0; i < n; i++) {
                times[i] = keyframes[i].time;
                values[i] = keyframes[i].value;

                if (i === 0) easing[i] = null;
                else easing[i] = this._compileTiming(keyframes[i].timing_function);
            }

            this.trackNames.push(t.track);
            this.tracks.push({
                times,
                values,
                easing,
                cursor: 0,
                start: times[0],
                end: times[n - 1],
                length: n
            });

            this.result[t.track] = values[0];
        }

        this._buildCache();
    }

    /* =========================
       查询
    ========================= */

    getValues(time) {
        if (this.cache) {
            return this._getFromCache(time);
        }

        const t = Number(time);

        for (let i = 0; i < this.tracks.length; i++) {
            const track = this.tracks[i];
            this.result[this.trackNames[i]] =
                this._sampleTrack(track, t);
        }

        return this.result;
    }

    _sampleTrack(track, tInput) {
        let t = tInput;

        if (this.options.loop && track.end > track.start) {
            const d = track.end - track.start;
            t = ((t - track.start) % d + d) % d + track.start;
        }

        const times = track.times;
        const values = track.values;
        const easing = track.easing;
        const n = track.length;

        if (t <= times[0]) return values[0];
        if (t >= times[n - 1]) return values[n - 1];

        let i = track.cursor;

        while (i < n - 1 && t > times[i + 1]) i++;
        while (i > 0 && t < times[i]) i--;

        track.cursor = i;

        const t0 = times[i];
        const t1 = times[i + 1];

        const v0 = values[i];
        const v1 = values[i + 1];

        const ease = easing[i + 1];
        if (!ease) return v0;

        const ratio = (t - t0) / (t1 - t0);
        const k = ease(ratio);

        return v0 + (v1 - v0) * k;
    }

    /* =========================
       构建缓存
    ========================= */

    _buildCache() {
        const step = this.options.cacheResolution;
        if (!step) {
            this.cache = null;
            return;
        }

        let start = Infinity;
        let end = -Infinity;

        for (const t of this.tracks) {
            if (t.start < start) start = t.start;
            if (t.end > end) end = t.end;
        }

        this.cacheStart = start;
        this.cacheEnd = end;
        this.cacheStep = step;
        this.cacheSize = Math.ceil((end - start) / step) + 1;

        this.cache = new Array(this.tracks.length);

        for (let ti = 0; ti < this.tracks.length; ti++) {
            this.cache[ti] = new Float64Array(this.cacheSize);
        }

        for (let i = 0; i < this.cacheSize; i++) {
            const t = start + i * step;

            for (let ti = 0; ti < this.tracks.length; ti++) {
                this.cache[ti][i] =
                    this._sampleTrack(this.tracks[ti], t);
            }
        }
    }

    /* =========================
       修复点：循环缓存查询
    ========================= */

    _getFromCache(timeInput) {
        let t = Number(timeInput);

        if (this.options.loop && this.cacheEnd > this.cacheStart) {
            const d = this.cacheEnd - this.cacheStart;
            t = ((t - this.cacheStart) % d + d) % d + this.cacheStart;
        }

        let idx = Math.floor((t - this.cacheStart) / this.cacheStep);

        if (idx < 0) idx = 0;
        if (idx >= this.cacheSize) idx = this.cacheSize - 1;

        for (let i = 0; i < this.tracks.length; i++) {
            this.result[this.trackNames[i]] =
                this.cache[i][idx];
        }

        return this.result;
    }

    /* =========================
       Timing
    ========================= */

    _compileTiming(tf) {
        if (!tf || tf === "none") return null;
        if (tf === "linear") return linear;

        if (tf === "ease") return ease;
        if (tf === "ease-in") return easeIn;
        if (tf === "ease-out") return easeOut;
        if (tf === "ease-in-out") return easeInOut;

        const m = tf.match(/cubic-bezier\(([^)]+)\)/);
        if (m) {
            const [x1, y1, x2, y2] = m[1]
                .split(",")
                .map(v => parseFloat(v.trim()));
            return cubicBezier(x1, y1, x2, y2);
        }

        return linear;
    }
}


/**
 * @typedef EnvelopeTrack
 * @param {String} track 轨道名称
 * @param {EnvelopeTrackKeyframes[]} keyframes 关键帧
 */

/**
 * @typedef EnvelopeTrackKeyframes
 * @param {Number} time 时间
 * @param {Number} value 值
 * @param {String} timing_function 与上一帧的过渡方式
 */



const linear = x => x;
const ease = cubicBezier(0.25, 0.1, 0.25, 1);
const easeIn = cubicBezier(0.42, 0, 1, 1);
const easeOut = cubicBezier(0, 0, 0.58, 1);
const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;

    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    function sampleX(t) {
        return ((ax * t + bx) * t + cx) * t;
    }

    function sampleY(t) {
        return ((ay * t + by) * t + cy) * t;
    }

    function sampleDX(t) {
        return (3 * ax * t + 2 * bx) * t + cx;
    }

    return function (x) {
        let t = x;
        for (let i = 0; i < 5; i++) {
            const dx = sampleX(t) - x;
            const d = sampleDX(t);
            if (Math.abs(d) < 1e-6) break;
            t -= dx / d;
        }
        return sampleY(t);
    };
}