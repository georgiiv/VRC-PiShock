import osc from 'osc';
import { OSCQueryServer, OSCTypeSimple, OSCQAccess } from "oscquery";
import portfinder from 'portfinder';
import { readFile } from 'fs/promises';
import fs from 'fs';
import date from 'date-and-time';

let cooldownActive = false;
let debounceParameters = {};

let AppConfig;
const argvAppConfig = process.argv.slice(2)[0];
let configSelection = "./config.json";

// Load config. Use the one provided as a command line argument, if provided
if (argvAppConfig != undefined) {
	if (fs.existsSync(argvAppConfig)) {
		configSelection = process.argv.slice(2)[0];
	}
	else {
		console.log("Config provided in command-line does not exist.")
	}
}
console.log("Loading config:", configSelection)
AppConfig = JSON.parse(await readFile(configSelection));

// Reload config when change is detected
fs.watchFile(configSelection, async (curr, prev) => {
	console.log(`\n${configSelection} has changed. Reloading config.`);
	AppConfig = JSON.parse(await readFile(configSelection));
});

function randomNumber(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function sendPiShock(operation, intensity, duration) {
	const now = new Date();
	console.log("\n[", date.format(now, 'HH:mm:ss'), "]");
	console.log("PiShock request sent:", operation, "\nIntensity:", intensity, "\nDuration:", duration);

	// MiniShock support?
	// if ((duration > 0) && (duration < 1)) {
	// 	duration = 300;
	// }

	// Iterate and send shock to all shock codes
	AppConfig.PiShockShareCodes.forEach(async (collar) => {
		let res = await fetch("https://do.pishock.com/api/apioperate", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				Username: AppConfig.PiShockConfig.PiShockUsername,
				Apikey: AppConfig.PiShockConfig.PiShockApikey,
				Name: AppConfig.PiShockConfig.PiShockName,
				Code: collar.shareCode,

				Op: operation,
				Duration: duration,
				Intensity: intensity
			}),
		});
		// console.log(res);
	})

}

const port = await portfinder.getPortPromise({
	port: randomNumber(11000, 33000),
});

const oscQuery = new OSCQueryServer({
	httpPort: port,
	serviceName: AppConfig.PiShockConfig.PiShockName
});

console.log(`Selected port: ${port}`);

oscQuery.addMethod("/avatar", {
	description: "Receives avatar parameters",
	access: OSCQAccess.WRITEONLY
});

await oscQuery.start();

const oscSocket = new osc.UDPPort({
	localAddress: '0.0.0.0',
	localPort: port,
	metadata: true
});

oscSocket.on('ready', () => {
	console.log("OSC socket started");
});

oscSocket.on('error', e => {
	// No log, no problem
});

oscSocket.on('message', (oscMsg, timeTag, rinfo) => {
	// console.log("Message received", oscMsg)
	AppConfig.acceptedParameters.forEach(element => {
		if (oscMsg.address.endsWith(element.paramName)) {
			// console.log("Message filter passed", element.paramName)

			if ((oscMsg.args[0].value >= element.activationThreshold)
				&& (cooldownActive == false)
				&& (debounceParameters[element.paramName] == undefined)
			) {
				// Set global cooldown and debounce
				cooldownActive = true;
				debounceParameters[element.paramName] = element.debounceThreshold;

				// Randomise shock intensity and duration within given range
				let operationInt = AppConfig.PiShockOperationTypes[element.operation.toLowerCase()];
				let durationRandom = randomNumber(element.duration.min, element.duration.max)
				let intensityRandom = randomNumber(element.intensity.min, element.intensity.max)

				sendPiShock(operationInt, intensityRandom, durationRandom);
				console.log("Cooling down:", (AppConfig.PiShockConfig.shockCooldown + (durationRandom * 1000)), "ms")
				// Timeout length will be whatever is set in the config + the shock duration
				setTimeout(() => { cooldownActive = false }, (AppConfig.PiShockConfig.shockCooldown + (durationRandom * 1000)));
			}

			// Clear debounce after value reaches debounce limit
			if ((debounceParameters[element.paramName] != undefined)
				&& (oscMsg.args[0].value <= element.debounceThreshold)
			) {
				debounceParameters[element.paramName] = undefined;
				// console.log("Debounce cleared", element.paramName)
			} else {
				// console.log("Debouncing", element.paramName);
			}
		}
	});
});

oscSocket.open();
