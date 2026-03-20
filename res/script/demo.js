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
    },
    onStrengthChanged: data => {
        $('#demo-label-strength-a').text(data.a);
        $('#demo-label-strength-b').text(data.b);
        $('#demo-label-local-strength-a').text(coyote2.strength.a);
        $('#demo-label-local-strength-b').text(coyote2.strength.b);
    },
    onPlayingLoop: data => {
        nowSendFrame = (nowSendFrame + 1) % 10;
        $('#demo-label-loop-count').text(++loopCount);
        $('.demo-send-frames .frame').removeClass('set');
        $('.demo-send-frames .frame').eq(nowSendFrame).addClass('set');
        $('#demo-label-envelope-playing').text(data.currentEnvelope.playing);
        $('#demo-label-envelope-time').text(data.currentEnvelope.time.toFixed(1));
        $('#demo-label-envelope-end-time').text(data.currentEnvelope.envelope?.tracksEndTime.toFixed(1));
        $('#demo-label-local-strength-a').text(coyote2.strength.a);
        $('#demo-label-local-strength-b').text(coyote2.strength.b);
    },
    onBatteryChanged: value => {
        $('#demo-label-battery').text(value);
    }
});

$(document).on('click', '#demo-btn-connect', async () => {
    await coyote2.connect();
    if (coyote2.connected) coyote2.getBattery();
});

$(document).on('click', '#demo-btn-disconnect', async () => {
    coyote2.disconnect();
});

$(document).on('click', '#demo-btn-start', () => {
    coyote2.start();
    $('#demo-label-local-strength-a').text(coyote2.strength.a);
    $('#demo-label-local-strength-b').text(coyote2.strength.b);
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
    $('#demo-label-local-strength-a').text(coyote2.strength.a);
    $('#demo-label-local-strength-b').text(coyote2.strength.b);
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