const fs = require("fs");
const path = require('path');

let checkLoggedDate = false; 
let config;

const COLOR = {
    new: (r, g, b) => `\x1b[38;2;${r};${g};${b}m`,
    
    reset: "\x1b[0m",
    black: `\x1b[38;2;0;0;0m`,
    dark_blue: `\x1b[38;2;0;0;170m`,
    dark_green: `\x1b[38;2;0;170;0m`,
    dark_red: `\x1b[38;2;170;0;0m`,
    dark_purple: `\x1b[38;2;170;0;170m`,
    dark_gray: `\x1b[38;2;85;85;85m`,
    cyan: `\x1b[38;2;0;170;170m`,
    gold: `\x1b[38;2;255;170;0m`,
    blue: `\x1b[38;2;85;85;255m`,
    green: `\x1b[38;2;85;255;85m`,
    aqua: `\x1b[38;2;85;255;255m`,
    red: `\x1b[38;2;255;85;85m`,
    yellow: `\x1b[38;2;255;255;85m`,
    gray: `\x1b[38;2;170;170;170m`,
    white: `\x1b[38;2;255;255;255m`,
    pink: `\x1b[38;2;255;85;255m`
};

function limitString(str) {
    return str.substring(0, 10).padEnd(10, ' ');
};

function checkDate() {
    try {
        if (checkLoggedDate) return;
        config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        let now = new Date();
        let options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
        let currentDate = now.toLocaleDateString('en-GB', options);

        if (currentDate !== config.lastLoggedDate) {
            checkLoggedDate = true
            BotLogs("SYSTEM", `${COLOR.new(255, 85, 153)}---------------------------------------------------------------`);
            BotLogs("SYSTEM", `${COLOR.new(255, 85, 153)}Starting a New Day: 📅 ${COLOR.white}${currentDate}`);
            BotLogs("SYSTEM", `${COLOR.new(255, 85, 153)}---------------------------------------------------------------`);
            config.lastLoggedDate = currentDate;
            fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
            checkLoggedDate = false
        };
    } catch (error) {
        console.log(`${COLOR.red}---------------------------------------------------------------${COLOR.reset}`);
        console.log(`${COLOR.red}Error Occurred in checkDate: ${COLOR.white}"${error.toString()}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"${COLOR.reset}`);
        console.log(`${COLOR.red}---------------------------------------------------------------${COLOR.reset}`);
    };
};

checkDate();

function BotLogs(host, msg) {
    checkDate();
    let now = new Date(Date.now());
    let hours = now.getHours();
    let period = hours >= 12 ? 'PM' : 'AM';
    let now_hours = now.getHours().toString().padStart(2, '0');
    let now_mins = now.getMinutes().toString().padStart(2, '0');
    let now_seconds = now.getSeconds().toString().padStart(2, '0');
    if (host == "SYSTEM") {
        console.log(`${COLOR.gray}[${COLOR.white}${now_hours}:${now_mins}:${now_seconds}${COLOR.gray}] [${COLOR.white}Main${COLOR.gray}] ${msg}`, `${COLOR.reset}`);
    } else {
        if (host == "AUDIO") {
            console.log(`${COLOR.gray}[${COLOR.white}${now_hours}:${now_mins}:${now_seconds}${COLOR.gray}] [${COLOR.white}Main${COLOR.gray}] ${msg}`, `${COLOR.reset}`);
        } else {
            let new_host = limitString(host);
            console.log(`${COLOR.gray}[${COLOR.white}${now_hours}:${now_mins}:${now_seconds}${COLOR.gray}] [${COLOR.white}${new_host}${COLOR.gray}] ${msg}`, `${COLOR.reset}`);
        };
    };
};

exports.BotLogs = BotLogs;
exports.COLOR = COLOR;