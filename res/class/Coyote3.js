class Coyote3 extends Coyote2 {
    constructor() {
        super();

        this.devicePrefix = '47L121'; // V3 主机

        this.uuid = {
            service: '0000180c-0000-1000-8000-00805f9b34fb',
            write: '0000150a-0000-1000-8000-00805f9b34fb',
            notify: '0000150b-0000-1000-8000-00805f9b34fb',
            batteryService: '0000180a-0000-1000-8000-00805f9b34fb',
            battery: '00001500-0000-1000-8000-00805f9b34fb'
        };

        this.sequence = 0;

        this.strengthState = {
            a: {
                accumulated: 0,
                deviceValue: 0,
                inputOrder: 0,
                allowed: true
            },
            b: {
                accumulated: 0,
                deviceValue: 0,
                inputOrder: 0,
                allowed: true
            }
        };

        this.balance = {
            freqA: 128,
            freqB: 128,
            powerA: 128,
            powerB: 128
        };

        this.softLimit = {
            a: 200,
            b: 200
        };

        this.waveBuffer = {
            a: this._createEmptyWave(),
            b: this._createEmptyWave()
        };
    }

    _createEmptyWave() {
        return {
            freq: [10, 10, 10, 10],
            amp: [0, 0, 0, 0]
        };
    }

    async connect() {
        if (this.inSession) return;

        this.inSession = true;

        this.bluetoothDevice = new BluetoothDeviceManager({
            namePrefix: this.devicePrefix,
            serviceIds: [
                this.uuid.service,
                this.uuid.batteryService
            ],
            configs: [
                {
                    serviceUuid: this.uuid.service,
                    characteristicUuid: this.uuid.notify,
                    autoStart: true
                },
                {
                    serviceUuid: this.uuid.batteryService,
                    characteristicUuid: this.uuid.battery,
                    autoStart: true
                }
            ],
            autoReconnect: true,
            reconnectInterval: 4000,
            useWriteQueue: false
        });

        this.bluetoothDevice.setEventHandlers({
            onConnected: async () => {
                this.connected = true;
                this.connecting = false;
                this.stateChangedNotification();

                await this.sendBF();
            },

            onDisconnected: () => {
                this.connected = false;
                this.connecting = false;
                this.inSession = false;
                this.stateChangedNotification();
            },

            onParsedValue: (serviceUuid, characteristicUuid, data) => {
                if (characteristicUuid === this.uuid.battery) {
                    this.batteryChangedNotification(data);
                }
            },

            onCharacteristicValueChanged: (serviceUuid, characteristicUuid, value) => {
                if (characteristicUuid === this.uuid.notify) {
                    this._handleNotify(new Uint8Array(value.buffer));
                }
            }
        });

        this.connecting = true;
        this.stateChangedNotification();

        await this.bluetoothDevice.scanAndConnect();
    }

    _handleNotify(bytes) {
        const head = bytes[0];

        if (head === 0xB1) {
            const order = bytes[1];
            const a = bytes[2];
            const b = bytes[3];

            this._strengthCallback(order, a, b);
        }
    }

    _strengthCallback(order, a, b) {
        this.strengthState.a.deviceValue = a;
        this.strengthState.b.deviceValue = b;

        if (order === this.strengthState.a.inputOrder) {
            this.strengthState.a.allowed = true;
        }
        if (order === this.strengthState.b.inputOrder) {
            this.strengthState.b.allowed = true;
        }

        this.events.onStrengthChanged?.({ a, b });
    }

    _processStrength(channelKey) {
        const state = this.strengthState[channelKey];

        let parsing = 0;
        let value = 0;
        let order = 0;

        if (state.allowed && state.accumulated !== 0) {
            if (state.accumulated > 0) parsing = 0b01;
            else parsing = 0b10;

            value = Math.abs(state.accumulated);
            this.sequence = (this.sequence + 1) & 0x0f;
            order = this.sequence;

            state.inputOrder = order;
            state.allowed = false;
            state.accumulated = 0;
        }

        return { parsing, value, order };
    }

    _buildB0() {
        const a = this._processStrength('a');
        const b = this._processStrength('b');

        const parsing =
            ((a.parsing & 0b11) << 2) |
            (b.parsing & 0b11);

        const order = a.order || b.order;

        const packet = new Uint8Array(20);

        packet[0] = 0xB0;
        packet[1] = (order << 4) | parsing;
        packet[2] = a.value;
        packet[3] = b.value;

        let offset = 4;

        for (let i = 0; i < 4; i++) packet[offset++] = this.waveBuffer.a.freq[i];
        for (let i = 0; i < 4; i++) packet[offset++] = this.waveBuffer.a.amp[i];
        for (let i = 0; i < 4; i++) packet[offset++] = this.waveBuffer.b.freq[i];
        for (let i = 0; i < 4; i++) packet[offset++] = this.waveBuffer.b.amp[i];

        return packet;
    }

    async sendB0() {
        const data = this._buildB0();

        await this.bluetoothDevice.writeCharacteristic(
            this.uuid.service,
            this.uuid.write,
            data
        );
    }

    async sendBF() {
        const packet = new Uint8Array(7);

        packet[0] = 0xBF;
        packet[1] = this.softLimit.a;
        packet[2] = this.softLimit.b;
        packet[3] = this.balance.freqA;
        packet[4] = this.balance.freqB;
        packet[5] = this.balance.powerA;
        packet[6] = this.balance.powerB;

        await this.bluetoothDevice.writeCharacteristic(
            this.uuid.service,
            this.uuid.write,
            packet
        );
    }

    setWave(channel, freqArray, ampArray) {
        const target = this.waveBuffer[channel];
        target.freq = freqArray.map(v => this._mapFreq(v));
        target.amp = ampArray.slice(0, 4);
    }

    _mapFreq(v) {
        if (v >= 10 && v <= 100) return v;
        if (v <= 600) return Math.floor((v - 100) / 5 + 100);
        if (v <= 1000) return Math.floor((v - 600) / 10 + 200);
        return 10;
    }

    increaseStrength(channel, value = 1) {
        this.strengthState[channel].accumulated += value;
    }

    decreaseStrength(channel, value = 1) {
        this.strengthState[channel].accumulated -= value;
    }

    zeroStrength(channel) {
        const state = this.strengthState[channel];
        this.sequence = (this.sequence + 1) & 0x0f;
        state.inputOrder = this.sequence;
        state.allowed = false;
        state.accumulated = 0;
    }

    playingLoop() {
        super.playingLoop();
        this.sendB0();
    }
}