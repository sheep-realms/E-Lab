class BluetoothDeviceManager {
    constructor({
        namePrefix,
        serviceIds = [],
        autoReconnect = true,
        reconnectInterval = 3000,
        configs = [],
        useWriteQueue = false,
        preferWriteWithoutResponse = true
    } = {}) {
        this.namePrefix = namePrefix;
        this.serviceIds = serviceIds;
        this.autoReconnect = autoReconnect;
        this.reconnectInterval = reconnectInterval;
        this.useWriteQueue = useWriteQueue;
        this.preferWriteWithoutResponse = preferWriteWithoutResponse;

        this.device = null;
        this.server = null;

        this.services = new Map();
        this.characteristics = new Map();

        this.writeQueue = [];
        this.isWriting = false;

        this.activeNotifications = new Set();
        this.bitfieldConfigs = new Map();

        for (const cfg of configs) {
            const key = `${cfg.serviceUuid}:${cfg.characteristicUuid}`;
            if (cfg.bitfields) {
                this.bitfieldConfigs.set(key, cfg.bitfields);
            }
            if (cfg.autoStart) {
                this.activeNotifications.add(key);
            }
        }

        this._reconnectTimer = null;

        this.events = {
            onDeviceSelected: null,
            onConnected: null,
            onConnectError: null,
            onDisconnected: null,
            onServiceDiscovered: null,
            onCharacteristicDiscovered: null,
            onCharacteristicValueChanged: null,
            onParsedValue: null,
            onBitfieldParsed: null,
            onReconnectAttempt: null
        };
    }

    setEventHandlers(handlers = {}) {
        Object.assign(this.events, handlers);
    }

    _charKey(serviceUuid, characteristicUuid) {
        return `${serviceUuid}:${characteristicUuid}`;
    }

    async scanAndConnect() {
        if (typeof navigator.bluetooth === 'undefined') {
            console.error('Web Bluetooth API 不可用');
            return;
        }

        if (this.server) {
            console.warn('已有设备连接，请先断开');
            return;
        }

        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: this.namePrefix }],
                optionalServices: this.serviceIds
            });

            this.device = device;
            device.addEventListener('gattserverdisconnected', this._handleDisconnected.bind(this));

            this.events.onDeviceSelected?.(device);
            await this._connect();
        } catch (error) {
            console.error('Scan failed:', error);
            this.events.onConnectError?.(error);
        }
    }

    async _connect() {
        if (!this.device) return;

        try {
            this.server = await this.device.gatt.connect();
            await this._discoverServices();
            await this._restoreNotifications();
            this.events.onConnected?.(this.device, this.server);
        } catch (error) {
            console.error('Connection failed:', error);
            this._scheduleReconnect();
        }
    }

    async _discoverServices() {
        this.services.clear();
        this.characteristics.clear();

        const services = await this.server.getPrimaryServices();

        for (const service of services) {
            this.services.set(service.uuid, service);
            this.events.onServiceDiscovered?.(service);

            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
                const key = this._charKey(service.uuid, char.uuid);
                this.characteristics.set(key, char);
                this.events.onCharacteristicDiscovered?.(service, char);
            }
        }
    }

    async getService(serviceUuid) {
        let service = this.services.get(serviceUuid);
        if (!service) {
            service = await this.server.getPrimaryService(serviceUuid);
            this.services.set(serviceUuid, service);
        }
        return service;
    }

    async getCharacteristic(serviceUuid, characteristicUuid) {
        const key = this._charKey(serviceUuid, characteristicUuid);
        let char = this.characteristics.get(key);

        if (!char) {
            const service = await this.getService(serviceUuid);
            char = await service.getCharacteristic(characteristicUuid);
            this.characteristics.set(key, char);
        }

        return char;
    }

    async readCharacteristic(serviceUuid, characteristicUuid) {
        const char = await this.getCharacteristic(serviceUuid, characteristicUuid);
        const value = await char.readValue();

        const parsed = this.parseDataView(value);
        const key = this._charKey(serviceUuid, characteristicUuid);
        const config = this.bitfieldConfigs.get(key);

        let bitParsed = null;
        if (config) {
            bitParsed = this.parseBitfields(parsed.bytes, config);
        }

        return {
            raw: value,
            parsed,
            bitfields: bitParsed
        };
    }

    async writeCharacteristic(serviceUuid, characteristicUuid, data) {
        if (!this.useWriteQueue) {
            return this._directWrite(serviceUuid, characteristicUuid, data);
        }

        return new Promise((resolve, reject) => {
            this.writeQueue.push({ serviceUuid, characteristicUuid, data, resolve, reject });
            this._processWriteQueue();
        });
    }

    async _directWrite(serviceUuid, characteristicUuid, data) {
        const char = await this.getCharacteristic(serviceUuid, characteristicUuid);

        let buffer;
        if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
            buffer = data;
        } else if (Array.isArray(data)) {
            buffer = new Uint8Array(data);
        } else {
            throw new Error('Unsupported data format');
        }

        if (this.preferWriteWithoutResponse && char.properties?.writeWithoutResponse) {
            return char.writeValueWithoutResponse(buffer);
        }

        return char.writeValue(buffer);
    }

    async _processWriteQueue() {
        if (this.isWriting) return;
        if (this.writeQueue.length === 0) return;

        this.isWriting = true;
        const item = this.writeQueue.shift();

        try {
            const char = await this.getCharacteristic(item.serviceUuid, item.characteristicUuid);

            let buffer;
            if (item.data instanceof Uint8Array || item.data instanceof ArrayBuffer) {
                buffer = item.data;
            } else if (Array.isArray(item.data)) {
                buffer = new Uint8Array(item.data);
            } else {
                throw new Error('Unsupported data format');
            }

            await char.writeValue(buffer);
            item.resolve();
        } catch (err) {
            item.reject(err);
        }

        this.isWriting = false;
        this._processWriteQueue();
    }

    async startNotifications(serviceUuid, characteristicUuid) {
        const char = await this.getCharacteristic(serviceUuid, characteristicUuid);
        const key = this._charKey(serviceUuid, characteristicUuid);

        await char.startNotifications();

        char.addEventListener('characteristicvaluechanged', event => {
            const value = event.target.value;
            const parsed = this.parseDataView(value);

            this.events.onCharacteristicValueChanged?.(
                serviceUuid,
                characteristicUuid,
                value
            );

            this.events.onParsedValue?.(
                serviceUuid,
                characteristicUuid,
                parsed
            );

            const config = this.bitfieldConfigs.get(key);
            if (config) {
                const bitParsed = this.parseBitfields(parsed.bytes, config);
                this.events.onBitfieldParsed?.(
                    serviceUuid,
                    characteristicUuid,
                    bitParsed
                );
            }
        });

        this.activeNotifications.add(key);
    }

    parseBitfields(bytes, config) {
        let value = 0n;
        for (let i = 0; i < bytes.length; i++) {
            value |= BigInt(bytes[i]) << BigInt(i * 8);
        }

        const result = {};

        for (const field of config) {
            const { name, from, to } = field;
            const high = BigInt(Math.max(from, to));
            const low = BigInt(Math.min(from, to));
            const mask = (1n << (high - low + 1n)) - 1n;
            const v = (value >> low) & mask;
            result[name] = Number(v);
        }

        return result;
    }

    parseDataView(dataView) {
        if (!(dataView instanceof DataView)) return dataView;

        const buffer = dataView.buffer.slice(
            dataView.byteOffset,
            dataView.byteOffset + dataView.byteLength
        );

        const bytes = new Uint8Array(buffer);

        return {
            bytes,
            hex: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' '),
            uint8: bytes,
            int8: new Int8Array(buffer)
        };
    }

    async stopNotifications(serviceUuid, characteristicUuid) {
        const key = this._charKey(serviceUuid, characteristicUuid);
        const char = this.characteristics.get(key);
        if (!char) return;

        await char.stopNotifications();
        this.activeNotifications.delete(key);
    }

    async _restoreNotifications() {
        for (const key of this.activeNotifications) {
            const [serviceUuid, characteristicUuid] = key.split(':');
            try {
                await this.startNotifications(serviceUuid, characteristicUuid);
            } catch {}
        }
    }

    disconnect() {
        if (!this.server) return;
        try {
            this.server.disconnect();
        } catch {}

        this._clearReconnect();
        this.server = null;
    }

    _handleDisconnected() {
        this.server = null;
        this.events.onDisconnected?.(this.device);

        if (this.autoReconnect) {
            this._scheduleReconnect();
        }
    }

    _scheduleReconnect() {
        if (!this.autoReconnect || !this.device) return;
        if (this._reconnectTimer) return;

        this._reconnectTimer = setInterval(() => {
            this.events.onReconnectAttempt?.();
            if (!this.server) {
                this._connect();
            }
        }, this.reconnectInterval);
    }

    _clearReconnect() {
        if (this._reconnectTimer) {
            clearInterval(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }
}