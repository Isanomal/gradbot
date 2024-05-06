/*
    This program is a simulator for building robots.
    Copyright (C) 2021 Robert Lowe <rlowe@semo.edu>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */ 
/**
 * @file userbot.js
 * @copyright Robert Lowe 2021
 * @license GPL 3.0 
 */

/******************************************
 * User Model of Robot Parts 
 ******************************************/

/**
 * Create a local model of a part from the given source.
 * @param {*} source 
 */
function Part(source) {
    this.name = source.name;
    this.type = source.type;

    this.toJSON = function () {
        result = {};
        for (var attr in this) {
            //skip parents and functions
            if (attr == "parent" || typeof this[attr] == "function") {
                continue;
            }
            result[attr] = this[attr];
        }
        return result;
    };

    /**
     * Return a sendable (postable to a worker) version of this object.
     */
    this.sendable = function() {
        //by default, just use the toJSON function
        return this.toJSON();
    };
}


/**
 * Local model of a motor.
 * @param source{*} The source object.
 */
function Motor(source) {
    Part.call(this, source);
    this.power = source.power;

    this.setPower = function(power) {
        this.power = power;
        postMessage(this.sendable());
    }
}

function Marker(source) {
    //construct the part
    Part.call(this, source);
    this.color = source.color;
    this.penDrawing = source.penDrawing;

    //set the marker color
    this.setColor = function(color) {
        this.color = color;
        postMessage(this.sendable());
    }

    //lower the pen
    this.penDown = function() {
        this.penDrawing = true;
        postMessage(this.sendable());
    }

    //raise the pen
    this.penUp = function() {
        this.penDrawing = false;
        postMessage(this.sendable());
    }


    /**
     * Receive a message from the user thread
     * @param {*} message 
     */
    this.receiveUser = function(message) {
        this.color = message.color;
        this.penDrawing = message.penDrawing;
    }
}


function Chassis(source) {
    Part.call(this, source);
    this.parts = [];
    this.code = source.code;

    //capture the parts
    for(var i = 0; i < source.parts.length; i++) {
        this.parts.push(constructPart(source.parts[i]));
    }
}


function Light(source) {
    Part.call(this, source);
    this.fill = source.fill;

    this.setColor = function(color) {
        this.fill = color;
        postMessage(this.sendable());
    }
}


function LightSensor(source) {
    Part.call(this, source);
    this.intensity = source.intensity;
}


function RangeSensor(source) {
    Part.call(this, source);
    this.distance = source.distance;
}


function Laser(source) {
    Part.call(this, source);

    this.command = null;

    this.fire = function() {
        this.command = "fire";
        postMessage(this.sendable());
    }
}

//LineSensor
// NOTE: The line sensor is unfinished. 
// uncommenting this code will cause bugs. 
// It has been kept for future work.
/*
function LineSensor(source) {
    Part.call(this, source);
}
*/

/**
 * Construct a local model object from the source.
 * This selects the appropriate constructor and invokes it.
 * @param {*} source 
 * @returns The user model object
 */
function constructPart(source) {
    if(source.type == "Chassis") {
        return new Chassis(source);
    } else if(source.type == "Motor") {
        return new Motor(source);
    } else if(source.type == "Marker") {
        return new Marker(source);
    } else if(source.type == "Light") {
        return new Light(source);
    } else if(source.type == "LightSensor") {
        return new LightSensor(source);
    } else if(source.type == "RangeSensor") {
        return new RangeSensor(source);
    } else if(source.type == "Laser") {
        return new Laser(source);
    }
    //LineSensor
    // NOTE: The line sensor is unfinished. 
    // uncommenting this code will cause bugs. 
    // It has been kept for future work.
    /*
    else if(source.type == "LineSensor") {
        return new LineSensor(source);
    }
    */

    // this is an unknown part!
    return undefined;
}


/******************************************
 * Message Handler 
 ******************************************/
onmessage = function(message) {
    // handle the type of the message
    if(message.data.type == "start") {
        runRobot(message.data.robot);
    } else if(message.data.type == "update") {
        updateRobot(message.data.update);
    }
}


/******************************************
 * Robot Running
 ******************************************/
var robot;
var robotFun;

/**
 * Run the user robot's code.
 * @param {*} source 
 */
async function runRobot(source) {
    console.log('Source object:', source); // Log the source object
    if (!source || !source.parts) {
        console.error("Invalid robot source data: Missing parts array");
        return;
    }

    robot = new Chassis(source);
    robotFun = await getRobotFunction(robot);

    console.log('Checking robotFun');
    console.log(typeof robotFun);

    robotFun(robot);
}


/**
 * Get the robot's code function.
 */
async function getRobotFunction(robot) {
    console.log('Creating getRobotFunction');

    var preamble = "";

    //Function to load the wasmoon
    async function loadWasmoon() {
        try {
            console.log('Loading wasmoon module...');
            //Load the wasmoon module
            const { LuaFactory } = await import('https://cdn.jsdelivr.net/npm/wasmoon@1.16.0/dist/index.min.js');
            console.log('wasmoon module loaded successfully');
            //Return the LuaFactory class
            return LuaFactory;
        } catch (error) {
            console.error('Error loading wasmoon module:', error);
            throw error;
        }
    }

    try {
        //Load the wasmoon module
        const LuaFactory = await loadWasmoon();

        //Reference all the robot variables inside the getRobotFunction
        for(var i = 0; i < robot.parts.length; i++) {
            preamble += "var " + robot.parts[i].name + " = r.parts[" + i + "];\n";
        }

        // Set JS functions to be global Lua functions
        console.log('Setting JS functions as global Lua functions');
        preamble += "lua.global.set('moveForward', () => forward.setPower(100));\n";
        preamble += "lua.global.set('moveBackward', () => forward.setPower(-100));\n";
        preamble += "lua.global.set('turnLeft', () => left.setPower(100));\n";
        preamble += "lua.global.set('turnRight', () => right.setPower(100));\n";
        preamble += "lua.global.set('stopMovement', () => { forward.setPower(0); left.setPower(0); right.setPower(0); });\n";

        // Define a Lua function to construct the parts
        console.log('Defining constructParts function');
        preamble += "lua.global.set('constructParts', (parts) => {\n";
        preamble += "  for (var i = 0; i < parts.length; i++) {\n";
        preamble += "    var part = parts[i];\n";
        preamble += "    if (part.type == 'Chassis') {\n";
        preamble += "      var chassis = new Chassis(part);\n";
        preamble += "      parts[i] = chassis;\n";
        preamble += "    } else if (part.type == 'Motor') {\n";
        preamble += "      var motor = new Motor(part);\n";
        preamble += "      parts[i] = motor;\n";
        preamble += "    } else if (part.type == 'Marker') {\n";
        preamble += "      var marker = new Marker(part);\n";
        preamble += "      parts[i] = marker;\n";
        preamble += "    } else if (part.type == 'Light') {\n";
        preamble += "      var light = new Light(part);\n";
        preamble += "      parts[i] = light;\n";
        preamble += "    } else if (part.type == 'LightSensor') {\n";
        preamble += "      var lightSensor = new LightSensor(part);\n";
        preamble += "      parts[i] = lightSensor;\n";
        preamble += "    } else if (part.type == 'RangeSensor') {\n";
        preamble += "      var rangeSensor = new RangeSensor(part);\n";
        preamble += "      parts[i] = rangeSensor;\n";
        preamble += "    } else if (part.type == 'Laser') {\n";
        preamble += "      var laser = new Laser(part);\n";
        preamble += "      parts[i] = laser;\n";
        preamble += "    }\n";
        preamble += "  }\n";
        preamble += "});\n"; //End of Lua function definition

        //Define a JavaScript function to call the Lua function
        console.log('Defining userFunction');
        preamble += "async function userFunction(lua) {\n"; //Pass lua as an arg
        preamble += "  console.log('Executing user code');\n";
        preamble += "  try {\n";
        preamble += "    await lua.doString(`constructParts(JSON.parse('${JSON.stringify(robot.parts)}'))`);\n";
        preamble += "    await lua.doString(`" + robot.code + "`);\n";
        preamble += "    console.log('User code execution completed');\n";
        preamble += "  } catch (error) {\n";
        preamble += "    console.error('Error executing user code:', error);\n";
        preamble += "  }\n";
        preamble += "}\n";
    } finally {
        //Close the Lua environment
        console.log('Closing Lua environment');
        preamble += "if (lua) lua.global.close();\n"; // Close lua if it exists
    }

    console.log('getRobotFunction created');

    //Wrap the preamble in an async function
    return new Function("lua", "r", "return (async function() {\n" + preamble + "})(lua, r);"); // Pass lua and robot as arguments
}






function updateRobot(update) {
    for(i in robot.parts) {
        var part = robot.parts[i];

        if(part.name == update.name) {
            for(var attr in update) {
                part[attr] = update[attr];
            }
        }
    }
}



/****************************************** 
 * Utility Functions 
 ******************************************/

/**
 * Delay for the specified number of milliseconds.
 * @param {*} ms - milliseonds to sleep
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
