class Coyote2 {
    constructor() {
        this.inSession = false;
        this.connecting = false;
        this.connected = false;
        this.playing = false;

        this.channel = {
            a: {
                strength: 0,
                wave: '21810F',
                waveData: {
                    x: 1,
                    y: 9,
                    z: 31
                }
            },
            b: {
                strength: 0,
                wave: '21810F',
                waveData: {
                    x: 1,
                    y: 9,
                    z: 31
                }
            }
        };

        this.strength = {
            a: 0,
            b: 0
        };
        this.strengthWriting = false;

        this.wave = '21810F';
        this.waveData = {
            x: 1,
            y: 9,
            x: 31
        };
        this.targetHz = 100;
        this.realHz = 100;

        this.timer = undefined;
        this.devicePrefix = 'D-LAB';
        this.uuid = {
            serviceA: '955a180a-0fe2-f5aa-a094-84b8d4f3e8ad',
            serviceB: '955a180b-0fe2-f5aa-a094-84b8d4f3e8ad',
            battery: '955a1500-0fe2-f5aa-a094-84b8d4f3e8ad',
            strength: '955a1504-0fe2-f5aa-a094-84b8d4f3e8ad',
            channelA: '955a1506-0fe2-f5aa-a094-84b8d4f3e8ad',
            channelB: '955a1505-0fe2-f5aa-a094-84b8d4f3e8ad'
        };
        this.bluetoothDevice = undefined;

        this.currentEnvelope = {
            playing: false,
            envelope: null,
            time: 0
        };

        this.events = {
            onBatteryChanged: null,
            onPlayingLoop: null,
            onStateChanged: null,
            onStrengthChanged: null
        };
    }

    /**
     * 编码波形
     * @param {Number} x 脉冲大小 [0, 31]
     * @param {Number} y 脉冲间隔 [0, 1023]
     * @param {Number} z 脉冲宽度 [0, 31]
     * @returns {String} 波形编码
     */
    _encodeWave(x, y, z) {
        if (x < 0 || x > 31) throw new Error("X 超出范围 (0–31)");
        if (y < 0 || y > 1023) throw new Error("Y 超出范围 (0–1023)");
        if (z < 0 || z > 31) throw new Error("Z 超出范围 (0–31)");

        const value = (z << 15) | (y << 5) | x;

        const byte0 = value & 0xFF;
        const byte1 = (value >> 8) & 0xFF;
        const byte2 = (value >> 16) & 0xFF;

        return (
            byte0.toString(16).padStart(2, "0") +
            byte1.toString(16).padStart(2, "0") +
            byte2.toString(16).padStart(2, "0")
        ).toUpperCase();
    }

    /**
     * 解码波形
     * @param {String} hex 波形编码
     * @returns {Object} 波形参数
     */
    _decodeWave(hex) {
        const byte0 = parseInt(hex.slice(0, 2), 16)
        const byte1 = parseInt(hex.slice(2, 4), 16)
        const byte2 = parseInt(hex.slice(4, 6), 16)

        const value = byte0 | (byte1 << 8) | (byte2 << 16)

        const x = value & 0b11111
        const y = (value >> 5) & 0b1111111111
        const z = (value >> 15) & 0b11111

        return { x, y, z }
    }

    /**
     * 根据目标频率计算最佳波形
     * @param {Number} targetHz 目标频率 (0, 1000]
     * @param {Number} z 脉冲宽度 [0, 31]
     * @returns {Object} 计算结果
     */
    _calculateBestParams(targetHz, z = this.waveData.z ?? 20) {
        if (targetHz <= 0 || targetHz > 1000) {
            throw new Error("目标频率范围应为 (0, 1000] Hz")
        }

        let best = null

        for (let x = 1; x <= 31; x++) {
            const period = Math.round((1000 * x) / targetHz)

            if (period < 10 || period > 1000) continue

            const y = period - x
            if (y < 0 || y > 1023) continue

            const realHz = (1000 * x) / (x + y)
            const error = Math.abs(realHz - targetHz)

            if (!best || error < best.error) {
                best = {
                    x,
                    y,
                    z,
                    period,
                    realHz,
                    error
                }
            }
        }

        if (!best) {
            throw new Error("无法找到合适参数")
        }

        best.bytes = this._encodeWave(best.x, best.y, best.z)

        return best
    }

    setEventHandlers(handlers = {}) {
        Object.assign(this.events, handlers);
    }

    async connect() {
        if (this.inSession) return;
        this.inSession = true;
        this.bluetoothDevice = new BluetoothDeviceManager({
            namePrefix: this.devicePrefix,
            serviceIds: [this.uuid.serviceA, this.uuid.serviceB],
            configs: [
                {
                    serviceUuid: this.uuid.serviceA,
                    characteristicUuid: this.uuid.battery,
                    autoStart: true
                }, {
                    serviceUuid: this.uuid.serviceB,
                    characteristicUuid: this.uuid.strength,
                    autoStart: true,
                    bitfields: [
                        { name: 'a', from: 11, to: 21 },
                        { name: 'b', from: 10, to: 0 }
                    ]
                }
            ],
            autoReconnect: true,
            reconnectInterval: 4000
        });

        this.bluetoothDevice.setEventHandlers({
            onConnected: async () => {
                this.connected = true;
                this.connecting = false;
                this.stateChangedNotification();
                console.log('设备已连接');

                this.bluetoothDevice.startNotifications(
                    this.uuid.serviceA,
                    this.uuid.battery
                );
                this.bluetoothDevice.startNotifications(
                    this.uuid.serviceB,
                    this.uuid.strength
                );
            },

            onDisconnected: () => {
                this.connected = false;
                this.connecting = false;
                this.inSession = false;
                this.stateChangedNotification();
                console.log('设备已断开');
            },

            onCharacteristicValueChanged: (serviceUuid, characteristicUuid, value) => {
                const data = new Uint8Array(value.buffer);
                // console.log('收到数据', data);
            },

            onParsedValue: (serviceUuid, characteristicUuid, data) => {
                if (characteristicUuid === this.uuid.battery) {
                    return this.batteryChangedNotification(data);
                }
            },

            onBitfieldParsed: (serviceUuid, characteristicUuid, data) => {
                if (characteristicUuid === this.uuid.strength) {
                    return this.strengthChangedNotification(data);
                }
            },

            onReconnectAttempt: () => {
                this.connected = false;
                this.connecting = true;
                this.stateChangedNotification();
                console.log('正在尝试重连...');
            },

            onConnectError: () => {
                this.connected = false;
                this.connecting = false;
                this.inSession = false;
                this.stateChangedNotification();
                console.log('连接发生错误');
            }
        });

        this.connecting = true;
        this.stateChangedNotification();
        await this.bluetoothDevice.scanAndConnect();
    }

    disconnect() {
        this.stop();
        this.bluetoothDevice.disconnect();
    }

    start() {
        if (this.playing) return;
        this.playing = true;
        this.stateChangedNotification();
        this.sendStrength();
        this.timer = rafInterval(() => {
            this.playingLoop();
        }, 100);
    }

    playingLoop() {
        this.events.onPlayingLoop({
            wave: {
                a: this.channel.a.wave,
                b: this.channel.b.wave
            },
            strength: {
                a: this.channel.a.strength,
                b: this.channel.b.strength
            },
            currentEnvelope: this.currentEnvelope
        });
        this.sendWave();
        if (!this.currentEnvelope.playing) return;
        const data = this.getEnvelopeValues();
        this.setStrength({
            a: data.channelA.strength,
            b: data.channelB.strength
        });
        this.nextEnvelopeTime();
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        this.stateChangedNotification();
        clearRafInterval(this.timer);
    }

    _hexStringToUint8Array(hexString) {
        if (hexString.length % 2 !== 0) {
            throw new Error('Hex string length must be even');
        }

        const array = new Uint8Array(hexString.length / 2);
        for (let i = 0; i < hexString.length; i += 2) {
            array[i / 2] = parseInt(hexString.substr(i, 2), 16);
        }
        return array;
    }

    async sendWave() {
        this.bluetoothDevice.writeCharacteristic(
            this.uuid.serviceB,
            this.uuid.channelA,
            this._hexStringToUint8Array(this.channel.a.wave)
        )
            .catch(error => {
                console.warn('写入异常：' + error);
            });
        this.bluetoothDevice.writeCharacteristic(
            this.uuid.serviceB,
            this.uuid.channelB,
            this._hexStringToUint8Array(this.channel.b.wave)
        )
            .catch(error => {
                console.warn('写入异常：' + error);
            });
    }

    /**
     * 设置强度
     * @param {Object} value 强度
     * @param {Number} value.a 通道A
     * @param {Number} value.b 通道B
     */
    setStrength(value) {
        const { a = this.channel.a.strength, b = this.channel.b.strength } = value;
        this.channel.a.strength = parseFloat(a.toFixed(3));
        this.channel.b.strength = parseFloat(b.toFixed(3));
        this.strengthWriting = true;
        this.sendStrength();
    }

    async sendStrength() {
        let realStrengthA = Math.round(this.channel.a.strength / 200 * 2047);
        let realStrengthB = Math.round(this.channel.b.strength / 200 * 2047);
        let setStrengthPkg = new Uint8Array([
            realStrengthA >> 5 & 0xff,
            ((realStrengthA << 3) & 0xff) | ((realStrengthB >> 8) & 0xff),
            realStrengthB & 0xff,
        ]);
        setStrengthPkg.reverse();
        this.bluetoothDevice.writeCharacteristic(this.uuid.serviceB, this.uuid.strength, setStrengthPkg);
    }

    async getStrength() {
        const data = await this.bluetoothDevice.readCharacteristic(this.uuid.serviceB, this.uuid.strength);

        return {
            a: Math.round(data.bitfields.a / 2047 * 200),
            b: Math.round(data.bitfields.b / 2047 * 200)
        }
    }

    async getBattery() {
        const data = await this.bluetoothDevice.readCharacteristic(this.uuid.serviceA, this.uuid.battery);

        return data.parsed.bytes[0];
    }

    setWaveXYZ(channel = 'all', waveData) {
        const {
            x = waveData.x ?? 1,
            y = waveData.y ?? 9,
            z = waveData.z ?? 31
        } = waveData;
        if (x < 0 || x > 31) throw new Error("X 超出范围 (0–31)");
        if (y < 0 || y > 1023) throw new Error("Y 超出范围 (0–1023)");
        if (z < 0 || z > 31) throw new Error("Z 超出范围 (0–31)");
        for (const key in waveData) {
            if (!Object.hasOwn(waveData, key)) continue;
            const e = waveData[key];
            if (channel === 'all' || channel === 'a') this.channel.a.waveData[key] = e;
            if (channel === 'all' || channel === 'b') this.channel.b.waveData[key] = e;
        }
        this.updateWave();
        return (channel === 'all' || channel === 'a') ? this.channel.a.waveData : this.channel.b.waveData;
    }

    updateWave() {
        this.channel.a.wave = this._encodeWave(
            this.channel.a.waveData.x,
            this.channel.a.waveData.y,
            this.channel.a.waveData.z
        );
        this.channel.b.wave = this._encodeWave(
            this.channel.b.waveData.x,
            this.channel.b.waveData.y,
            this.channel.b.waveData.z
        );
    }

    loadEnvelope(envelope) {
        this.currentEnvelope.envelope = envelope;
        this.currentEnvelope.time = 0;
    }

    playEnvelope() {
        this.currentEnvelope.playing = true;
    }

    pauseEnvelope() {
        this.currentEnvelope.playing = false;
    }

    getEnvelopeValues(time = this.currentEnvelope.time) {
        const values = this.currentEnvelope.envelope.getValues(time);
        return {
            channelA: {
                strength: values.channel_a_strength
            },
            channelB: {
                strength: values.channel_b_strength
            }
        }
    }

    nextEnvelopeTime() {
        this.currentEnvelope.time = parseFloat(
            (
                (this.currentEnvelope.time + 0.1) % Math.ceil(this.currentEnvelope.envelope.tracksEndTime)
            ).toFixed(3)
        );
        return this.currentEnvelope.time;
    }

    stateChangedNotification() {
        this.events.onStateChanged?.({
            inSession: this.inSession,
            connected: this.connected,
            connecting: this.connecting,
            playing: this.playing
        });
    }

    strengthChangedNotification(data) {
        const { a, b } = {
            a:  Math.round(data.a / 2047 * 200),
            b:  Math.round(data.b / 2047 * 200)
        }
        if (this.strengthWriting) {
            this.strengthWriting = false;
        } else {
            this.channel.a.strength = a;
            this.channel.b.strength = b;
        }
        this.events.onStrengthChanged?.({ a, b });
    }

    batteryChangedNotification(data) {
        this.events.onBatteryChanged?.(data.bytes[0]);
    }
}