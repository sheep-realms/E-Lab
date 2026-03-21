let coyote2 = new Coyote2();
let nowSendFrame = -1;
let loopCount = 0;

coyote2.setEventHandlers({
    onStateChanged: data => {
        $('#demo-btn-connect').text(data.connecting ? 'Connecting...' : 'Connect');
        $('#demo-btn-connect').prop('disabled', data.connecting || data.connected);
        $('#demo-btn-disconnect').prop('disabled', !data.connected);
        $('#demo-btn-strength').prop('disabled', !data.connected);
        $('#demo-btn-start').prop('disabled', !data.connected || data.playing);
        $('#demo-btn-stop').prop('disabled', !data.connected || !data.playing);
        if (!data.connected) {
            $('#demo-label-strength-a, #demo-label-strength-b, #demo-label-battery').text('?');
        }
    },
    onStrengthChanged: data => {
        $('#demo-label-strength-a').text(data.a);
        $('#demo-label-strength-b').text(data.b);
        $('#demo-label-local-strength-a').text(coyote2.channel.a.strength);
        $('#demo-label-local-strength-b').text(coyote2.channel.b.strength);
    },
    onPlayingLoop: data => {
        nowSendFrame = (nowSendFrame + 1) % 10;
        $('#demo-label-loop-count').text(++loopCount);
        $('.demo-send-frames .frame').removeClass('set');
        $('.demo-send-frames .frame').eq(nowSendFrame).addClass('set');
        $('#demo-label-envelope-playing').text(data.currentEnvelope.playing);
        $('#demo-label-envelope-time').text(data.currentEnvelope.time.toFixed(1));
        $('#demo-label-envelope-end-time').text(data.currentEnvelope.envelope?.tracksEndTime.toFixed(1));
        $('#demo-label-local-strength-a').text(coyote2.channel.a.strength);
        $('#demo-label-local-strength-b').text(coyote2.channel.b.strength);
    },
    onBatteryChanged: value => {
        $('#demo-label-battery').text(value);
    }
});

$(document).on('click', '#demo-btn-connect', async () => {
    await coyote2.connect();
    if (coyote2.connected) {
        coyote2.getBattery();
        coyote2.getStrength();
    }
});

$(document).on('click', '#demo-btn-disconnect', async () => {
    coyote2.disconnect();
});

$(document).on('click', '#demo-btn-start', () => {
    coyote2.start();
    $('#demo-label-local-strength-a').text(coyote2.channel.a.strength);
    $('#demo-label-local-strength-b').text(coyote2.channel.b.strength);
});

$(document).on('click', '#demo-btn-stop', () => {
    coyote2.stop();
});

$(document).on('click', '#demo-btn-strength', () => {
    const strength = {
        a: Number($('#demo-ipt-strength-a').val()),
        b: Number($('#demo-ipt-strength-b').val())
    };
    coyote2.setStrength(strength);
    $('#demo-label-local-strength-a').text(coyote2.channel.a.strength);
    $('#demo-label-local-strength-b').text(coyote2.channel.b.strength);
});

function getWaveXYZ() {
    const x = Number($('#demo-ipt-wave-x').val());
    const y = Number($('#demo-ipt-wave-y').val());
    const z = Number($('#demo-ipt-wave-z').val());
    return { x, y, z};
}

$(document).on('click', '#demo-btn-wave', () => {
    coyote2.setWaveXYZ('all', getWaveXYZ());
});

$(document).on('click', '#demo-btn-wave-a', () => {
    coyote2.setWaveXYZ('a', getWaveXYZ());
});

$(document).on('click', '#demo-btn-wave-b', () => {
    coyote2.setWaveXYZ('b', getWaveXYZ());
});

$(document).on('click', '#demo-btn-envelope-load', () => {
    const value = $('#demo-ipt-envelope-data').val();
    let data;
    try {
        data = JSON.parse(value);
    } catch (error) {
        return;
    }
    coyote2.loadEnvelope(new Envelope(
        data,
        {
            loop: true,
            cacheResolution: 0.1
        }
    ));
    $('#demo-btn-envelope-play').prop('disabled', false);
});

$(document).on('click', '#demo-btn-envelope-unload', () => {
    coyote2.unloadEnvelope();
    $('#demo-btn-envelope-play').prop('disabled', true);
    $('#demo-btn-envelope-pause').prop('disabled', true);
});

$(document).on('click', '#demo-btn-envelope-play', () => {
    coyote2.playEnvelope();
    $('#demo-btn-envelope-play').prop('disabled', true);
    $('#demo-btn-envelope-pause').prop('disabled', false);
});

$(document).on('click', '#demo-btn-envelope-pause', () => {
    coyote2.pauseEnvelope();
    $('#demo-btn-envelope-play').prop('disabled', false);
    $('#demo-btn-envelope-pause').prop('disabled', true);
});

$(document).on('click', '#demo-btn-envelope-video-sync', () => {
    coyote2.syncEnvelope(() => {
        return videoPlayer.currentTime;
    });
});

const demoTracks = [
        {
            "track": "channel_a_strength",
            "keyframe": [
                {
                    "time": 0,
                    "value": 0
                }, {
                    "time": 5,
                    "value": 50,
                    "timing_function": "linear"
                }, {
                    "time": 7,
                    "value": 0,
                    "timing_function": "linear"
                }
            ]
        },
        {
            "track": "channel_a_wave_y",
            "keyframe": [
                {
                    "time": 0,
                    "value": 9
                }, {
                    "time": 5,
                    "value": 30,
                    "timing_function": "linear"
                }, {
                    "time": 7,
                    "value": 9,
                    "timing_function": "linear"
                }
            ]
        }
    ]

let envelope = new Envelope(
    demoTracks,
    {
        loop: true,
        cacheResolution: 0.1
    }
);

$('#demo-ipt-envelope-data').val(JSON.stringify(demoTracks,null,4));




// 视频播放器

const $videoInput = $('#demo-video-input');
const $videoPlayer = $('#demo-video-player');
const $timeDisplay = $('#demo-video-time-display');
const $stepFrame1 = $('#demo-btn-video-step-frame-1');
const $stepFrame2 = $('#demo-btn-video-step-frame-2');

const videoPlayer = $videoPlayer[0];

let objectUrl = null;

$videoInput.on('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(f);

    $videoPlayer.attr('src', objectUrl);
    videoPlayer.load();
    $('#demo-btn-envelope-video-sync').prop('disabled', false);
});

$(window).on('unload', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
});

$timeDisplay.on('click', async () => {
    const num = parseFloat(videoPlayer.currentTime.toFixed(3));
    const text = String(num);
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {}
});

$stepFrame1.on('click', () => {
    stepFrame(-1);
});

$stepFrame2.on('click', () => {
    stepFrame(1);
});

function getFPS() {
    const v = 60;
    return (isFinite(v) && v > 0) ? v : 60;
}

function fmt(t) {
    if (!isFinite(t)) return '0.000';
    return t.toFixed(3);
}

function stepFrame(direction) {
    const fps = getFPS();
    const step = 1 / fps;

    videoPlayer.pause();

    let target = videoPlayer.currentTime + direction * step;
    if (target < 0) target = 0;
    if (videoPlayer.duration && target > videoPlayer.duration) {
        target = videoPlayer.duration;
    }

    try {
        videoPlayer.currentTime = target;
    } catch (e) {
        const t = Math.max(
            0,
            Math.min(videoPlayer.duration || 1e9, target)
        );
        setTimeout(() => {
            videoPlayer.currentTime = t;
        }, 0);
    }

    $timeDisplay.text(fmt(target));
}

let rafId = null;

function updateTime() {
    $timeDisplay.text(fmt(videoPlayer.currentTime));
    rafId = requestAnimationFrame(updateTime);
}

$videoPlayer.on('play', () => {
    if (!rafId) updateTime();
});

$videoPlayer.on('pause', () => {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    $timeDisplay.text(fmt(videoPlayer.currentTime));
});