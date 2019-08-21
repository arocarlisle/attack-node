const child_process = require( "child_process" );
const fs = require( "fs" );
const os = require( "os" );
const config = JSON.parse( fs.readFileSync( "./config.json" ).toString() );
const log = Number( config.global.log.level );
let startTime = new Date().getTime();

if(config.global.time > 0){
    setTimeout( () => {
        main_exit()
    }, config.global.time * 1000 );
}

const logger = ( type, title, msg ) => {
    let time = new Date();
    if ( type == "DEBUG" && log >= 4 ) {
        console.debug( `\x1b[47m\x1b[34m ${time} \x1b[46m\x1b[37m ${title} \x1b[47m\x1b[32m ${msg} \x1b[0m` );
    }

    if ( type == "INFO" && log >= 3 ) {
        console.log( `\x1b[47m\x1b[34m ${time} \x1b[46m\x1b[37m ${title} \x1b[47m\x1b[32m ${msg} \x1b[0m` );
    }

    if ( type == "WARN" && log >= 2 ) {
        console.warn( `\x1b[47m\x1b[34m ${time} \x1b[46m\x1b[33m ${title} \x1b[47m\x1b[32m ${msg} \x1b[0m` );
    }

    if ( type == "ERROR" && log >= 1 ) {
        console.error( `\x1b[47m\x1b[34m ${time} \x1b[46m\x1b[31m ${title} \x1b[47m\x1b[32m ${msg} \x1b[0m` );
    }

    if ( config.global.log.log ) {
        try {
            fs.statSync("./log")
        } catch (error) {
            fs.mkdirSync("./log");
        }
        
        let t = new Date();
        let date = `${t.getFullYear()}-${t.getMonth()}-${t.getDay()}`;

        if ( !fs.existsSync( `./log/log-${date}.log` ) ) {
            fs.writeFileSync( `./log/log-${date}.log`, `` );
        }
        let data = fs.readFileSync( `./log/log-${date}.log` );
        fs.writeFileSync( `./log/log-${date}.log`, `${data}\n[${time}][${title}] ${msg}` );
    }
}

const _code = ( code ) => {
    if ( !code ) {
        return true;
    } else {
        let a = String( code ).substr( 0, 1 );
        if ( a == "2" || a == "3" ) {
            return true;
        } else {
            return false;
        }
    }
}

let processNumber = 0;
let processes = new Array();
let restart = true;
let n_fail = 0;
let n_success = 0;
let n_total = 0;
let max_success = 0;
let aliveProcess = 0;
let total = {
    total: 0,
    success: 0,
    fail: 0
};
let codeList = new Object();
let status;

if ( config.global.processNumber == -1 ) {
    processNumber = os.cpus().length * 4;
} else {
    processNumber = config.global.processNumber;
}

logger( "INFO", `[INFO][Process-Main]`, `Starting...` );
logger( "INFO", `[INFO][Process-Main]`, `Process: ${processNumber}` );
logger( "INFO", `[INFO][Process-Main]`, `Maximum Concurrency: ${(1e3 / config.global.delay) * processNumber * config.stream.length * config.global.thread}` );

setInterval( () => {
    if(n_success > max_success){
        max_success = n_success;
    }
    logger( "INFO", `[INFO][Process-Main]`, `total: ${n_total}, fail: ${n_fail}, success: ${n_success}, max success: ${max_success}` );
    if(config.global.status){
        status.send({
            type: "data",
            data: {
                total: n_total,
                success: n_success,
                fail: n_fail,
                maxSuccess: max_success,
                process: aliveProcess,
            }
        })
    }

    n_total = 0;
    n_fail = 0;
    n_success = 0;
}, 1e3 );

if(config.global.status){
    status = child_process.fork("./statusWeb/app.js");
}

for ( let i = 0; i < processNumber; i++ ) {
    processes[ i ] = child_process.fork( './start.js' );
    aliveProcess++;
    processes[ i ].on( 'message', ( m ) => {
        processEvent.msg( i, m );
    } );
    processes[ i ].on( 'close', ( code ) => {
        processEvent.exit( i, code );
    } );
}

logger( "INFO", `[INFO][Process-Main]`, `Started!` );

var processEvent = {
    msg: ( i, msg ) => {
        let type = msg.type;

        if ( type == "request" ) {
            let err = msg.data[ 0 ];
            let code = msg.data[ 1 ];
            let body = msg.data[ 2 ];
            let url = msg.data[ 3 ];
            total.total++;
            n_total++;
            if ( isNaN( codeList[ String( code ) ] ) ) {
                codeList[ String( code ) ] = 1;
            } else {
                codeList[ String( code ) ]++;
            }
            if ( _code( code ) && !err ) {
                logger( "DEBUG", `[INFO][Process-${i}]`, `Code：${code} Success ${url} ${body}` );
                n_success++;
                total.success++
            } else if ( code != null ) {
                n_fail++;
                total.fail++
                logger( "WARN", `[WARN][Process-${i}]`, `Code: ${code}` );
            }
        } else if ( type == "console" ) {
            logger( "INFO", `[INFO][Process-${i}]`, msg.data );
        }
    },
    exit: ( i, code ) => {
        aliveProcess--;
        if ( code == 0 ) {
            logger( "WARN", `[WARN][Process-${i}]`, `exit ${code}` );
        } else {
            logger( "ERROR", `[ERROR][Process-${i}]`, `exit ${code}` );
        }
        if ( restart ) {
            processes[ i ] = child_process.fork( './start.js' );
            aliveProcess++;
            processes[ i ].on( 'message', ( m ) => {
                processEvent.msg( i, m );
            } );
            processes[ i ].on( 'close', ( code ) => {
                processEvent.exit( i, code );
            } );
            logger( "INFO", `[INFO][Process-${i}]`, "restart" );
        }
    }
}

function main_exit() {
    status.send({
        type: "exit"
    });
    processes.forEach( e => {
        e.send( [ "exit" ] );
    } )
    logger( "INFO", `[INFO][Process-Main]`, `total: ${total.total}, fail: ${total.fail}, success: ${total.success}` );
    Object.keys( codeList ).forEach( e => {
        if ( e != "null" ) {
            logger( "INFO", `[INFO][Process-Main]`, `${e}: ${codeList[e]}` );
        }
    } )

    let t = new Date().getTime() - startTime;
    logger( "INFO", `[INFO][Process-Main]`, `${t/1000/60} min` );
    process.exit( 0 );
}

process.on( 'SIGINT', function () {
    main_exit()
} );