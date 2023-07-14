/**
 * @file index.js
 * Simple application of the TMSocket class – just prints all messages to the console and 
 * provides a simple interface for field control via the console
 * @author John Holbrook
 */

const TM3Socket = require("./tm3_socket.js");

const readline = require("readline");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const prompt = (query) => new Promise((resolve) => rl.question(query, resolve));

const delay = ms => new Promise(res => setTimeout(res, ms))

async function main(){
    // create an instance of TM3Socker and connect to TM
    let tm = new TM3Socket("192.168.1.30", "test", "division1", 1, true);
    await tm._connectWebsocket();

    await delay(500);

    while (true){
        let cmd = await prompt("Enter command or h for help: ");

        if (cmd == "n"){ // queue next match
            tm.queueNextMatch();
        }
        else if (cmd == "p"){ // queue previous match
            console.log("Not yet supported");
        }
        else if (cmd == "s"){ // start match
            tm.startMatch();
        }
        else if (cmd == "e"){ // end match early
            tm.endEarly();
        }
        else if (cmd == "a"){ // abort match
            tm.abortMatch();
        }
        else if (cmd == "r"){ // reset timer 
            tm.resetTimer();
        }
        else if (cmd == "q"){
            process.exit();
        }
        else{
            if (cmd != "h") console.log("Command not recognized.");
            console.log(`Commands list: 
            s - start match
            n - queue next match
            p - queue previous match
            e - end match early
            a - abort match
            r - reset timer
            q - quit`)
        }
    }
}

main();