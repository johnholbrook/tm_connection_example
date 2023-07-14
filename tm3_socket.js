/**
 * @file tm3_socket.js
 * Provides a class to connect to VEX Tournament Manager (2023-24 season versions) and interact with field control.
 * @author John Holbrook
 */

const FormData = require('form-data');
const util = require('util');
const WebSocket = require('ws');
const protobuf = require('protobufjs');

module.exports = class TM3Socket{
    /**
     * TM3Scraper constructor
     * @param {*} addr the address of the TM server
     * @param {*} pw TM admin password
     * @param {*} div name of the division (as used in the web interface URLs, e.g. "division1")
     * @param {*} fs ID of the field set to connect to
     * @param {boolean} omit Omit country from team name if there is also a state/province
     */
    constructor(addr, pw, div, fs){
        this.addr = addr; // TM server address
        this.pw = pw; // TM admin password
        this.division = div; // name of the division (as used in the web interface URLs, e.g. "division1")
        this.fs = fs; // ID of the field set to connect to (starts at 1 and counts up from there)
        
        this.cookie = null; // the session cookie
        this.cookie_expiration = null; // the expiration time of the cookie

        this.currentFieldId = null; // ID of the current field

        this.socket = null; // websocket connection to the TM server
    
        this.pb = null; // protobuf schema
        this.fs_notice = null; // protobuf message type "FieldSetNotice"
        this.fs_request = null; // protobuf message type "FieldSetRequest"
        this.fc_request = null; // protobuf message type "FieldControlRequest"

    }

    /**
     * Authenticates with the TM server and gets the session cookie.
     */
    async _authenticate(){
        console.log(`Authenticating with TM server at http://${this.addr}...`);

        // send form data to server
        let form = new FormData();
        form.append('user', 'admin');
        form.append('password', this.pw);
        form.append('submit', '');
        let submitForm = util.promisify((addr, callback) => form.submit(addr, callback));
        let cookie_text = (await submitForm(`http://${this.addr}/admin/login`)).headers['set-cookie'][0];

        // extract the session cookie
        let cookie_data = cookie_text.split(';')[0].split('"')[1];
        this.cookie = `user="${cookie_data}"`;

        // extract the expiration time (cookie is good for 1 hour)
        let cookie_expiration = cookie_text.split(';')[1].split('=')[1];
        let expiration_date = new Date(cookie_expiration);
        this.cookie_expiration = expiration_date;
    }

    /**
     * Establishes a websocket connection to the TM server.
     */
    async _connectWebsocket(){
        // if the cookie is missing or expired, authenticate
        if(!this.cookie || this.cookie_expiration < new Date()){
            await this._authenticate();
        }

        // if the websocket is already open, do nothing
        if (this.websocket){
            return;
        }

        // open and parse the protobuf schema
        this.pb = await protobuf.load("fieldset.proto");
        this.fs_notice = this.pb.lookupType("FieldSetNotice");
        this.fs_request = this.pb.lookupType("FieldSetRequest");
        // this.fc_request = this.pb.lookupType("FieldControlRequest");

        this.websocket = new WebSocket(`ws://${this.addr}/fieldsets/${this.fs}`, {
            headers: {
                Cookie: this.cookie
            }
        });

        this.websocket.on('open', () => {
            console.log('WebSocket connected');
            
            // send handshake to TM
            let hs = this._generateHandshake();
            console.log("Initiating handshake...");
            this._send(hs);
        });

        this.websocket.on('close', () => {
            console.log('WebSocket disconnected');
        });

        this.websocket.on('message', async event => {
            this._handleMessage(event);
        });
    }

    /**
     * Send a message to the TM server
     * @param {Buffer} data - data to send
     */
    async _send(data){
        await this._connectWebsocket();
        this.websocket.send(data);
    }

    /**
     * Generates the "handshake message" needed to send to TM.
     * The message is 128 bytes long, namely:
     * - 7 bytes of padding (content irrelevant)
     * - Current UNIX timestamp in seconds since epoch (little-endian). Must be within 300s of TM server's time for handshake to be accepted.
     * - 117 bytes of padding (content irrelevant)
     * Yes, really. ¯\_(ツ)_/¯
     */
    _generateHandshake(){
        let unixTime = (Math.floor(Date.now() / 1000)).toString(16); // unix timestamp in big-endian hex
        
        // create byte array
        let hs = new Uint8Array(128);

        // write time to byte array (little-endian)
        hs[7]  = parseInt(unixTime.slice(6,8), 16);
        hs[8]  = parseInt(unixTime.slice(4,6), 16);
        hs[9]  = parseInt(unixTime.slice(2,4), 16);
        hs[10] = parseInt(unixTime.slice(0,2), 16);
        
        return hs;
    }

    /**
     * "Unmangles" a message recieved from the TM server into something decodable as a protobuf
     * @param {Buffer} raw_data – Data to unmangle
     * @returns unmangled data, which can be interpreted as a protpbuf
     */
    _unmangle(raw_data){
        let magic_number = raw_data[0] ^ 229;
        // console.log("Magic number: ", magic_number);

        let unmangled_data = Buffer.alloc(raw_data.length - 1);
        for (let i=1; i<raw_data.length; i++){
            unmangled_data[i-1] = raw_data[i] ^ magic_number;
        }

        return unmangled_data;
    }

    /**
     * "Mangles" a message before it can be sent to TM (the inverse of _unmangle above)
     * @param {Buffer} data - (protobuf) data to be mangled
     * @param {Int8} magic_number - magic number to use (pick any value or omit to use the default of 123)
     * @returns mangled data to be sent to TM
     */
    _mangle(data, magic_number = 123){
        let mangled_data = Buffer.alloc(data.length + 1);

        mangled_data[0] = magic_number ^ 229;

        for (let i=1; i<mangled_data.length; i++){
            mangled_data[i] = data[i-1] ^ magic_number;
        }

        return mangled_data;
    }

    /**
     * Message handler
     * @param {Buffer} message - Message to be handled, exactly as recieved from TM
     */
    async _handleMessage(message){
        let unmangled = this._unmangle(message);

        let decoded = this.fs_notice.decode(unmangled);

        // update current field ID if needed
        if (decoded.id == 8){
            this.currentFieldId = decoded.fieldId;
        }

        console.log(decoded);
    }


    _sendFSRequest(msg){
        let buffer = this.fs_request.encode(msg).finish();
        let mangled = this._mangle(buffer);
        this._send(mangled);
    }

    /**
     * Construct and send a "FieldControlRequest" with the specified value
     * @param {Number} value - value to send. Meanings are:
     * 0 - none (idk what this does yet)
     * 1 - start match
     * 2 - end early
     * 3 - abort
     * 4 - reset timer
     */
    _sendFCRequest(value){
        let message = {
            fieldControl: {
                id: value,
                fieldId: this.currentFieldId
            }
        };

        this._sendFSRequest(message);
    }

    startMatch(){
        this._sendFCRequest(1);
    }

    endEarly(){
        this._sendFCRequest(2)
    }

    abortMatch(){
        this._sendFCRequest(3);
    }

    resetTimer(){
        this._sendFCRequest(4);
    }
}