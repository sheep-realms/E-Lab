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
    },
    onPlayingLoop: data => {
        nowSendFrame = (nowSendFrame + 1) % 10;
        $('#demo-label-loop-count').text(++loopCount);
        $('.demo-send-frames .frame').removeClass('set');
        $('.demo-send-frames .frame').eq(nowSendFrame).addClass('set');
        $('#demo-label-envelope-playing').text(data.currentEnvelope.playing);
        $('#demo-label-envelope-time').text(data.currentEnvelope.time.toFixed(1));
        $('#demo-label-envelope-end-time').text(data.currentEnvelope.envelope.tracksEndTime.toFixed(1));
    }
});

$(document).on('click', '#demo-btn-connect', async () => {
    await coyote2.connect();
});

$(document).on('click', '#demo-btn-disconnect', async () => {
    coyote2.disconnect();
});

$(document).on('click', '#demo-btn-start', () => {
    coyote2.start();
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
});

let envelope = new Envelope(
    [
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
    ],
    {
        loop: true,
        cacheResolution: 0.1
    }
);