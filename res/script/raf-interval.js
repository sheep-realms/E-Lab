function rafInterval(callback, delay) {
    let start = performance.now();
    let handle = { active: true };

    function tick(now) {
        if (!handle.active) return;
        if (now - start >= delay) {
            callback();
            start = now;
        }
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
    return handle;
}

function clearRafInterval(handle) {
    handle.active = false;
}