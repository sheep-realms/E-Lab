class Coyote2 {
    constructor() {
        this.inSession = false;
        this.connecting = false;
        this.connected = false;
        this.playing = false;
        this.strength = {
            a: 0,
            b: 0
        };
        this.wave = '21810F';
        this.devicePrefix = 'D-LAB';
        this.timer = undefined;
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
            onStateChanged: null,
            onStrengthChanged: null
        };
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
        this.bluetoothDevice.writeCharacteristic(this.uuid.serviceB, this.uuid.channelA, this._hexStringToUint8Array(this.wave))
            .catch(error => {
                console.warn('写入异常：' + error);
            });
        this.bluetoothDevice.writeCharacteristic(this.uuid.serviceB, this.uuid.channelB, this._hexStringToUint8Array(this.wave))
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
        const { a = this.strength.a, b = this.strength.b } = value;
        this.strength.a = a;
        this.strength.b = b;
        this.sendStrength();
    }

    async sendStrength() {
        let realStrengthA = Math.round(this.strength.a / 200 * 2047);
        let realStrengthB = Math.round(this.strength.b / 200 * 2047);
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

    playEnvelope(envelope) {
        this.currentEnvelope.playing = true;
        this.currentEnvelope.envelope = envelope;
        this.currentEnvelope.time = 0;
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
        return this.currentEnvelope.time += 0.1;
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
        this.strength.a = a;
        this.strength.b = b;
        this.events.onStrengthChanged?.({ a, b });
    }
}