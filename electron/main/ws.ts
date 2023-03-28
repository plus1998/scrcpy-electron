import WebSocket from 'ws'
import cp from 'child_process'
import { Socket } from 'net';

import { scrcpyDir } from './config'
const adb = `${scrcpyDir}\\adb.exe`
const scrcpyServer = `${scrcpyDir}\\scrcpy-server`

const freePorts = [];
const getFreePort = async () => {
    if (!freePorts.length) {
        for (let i = 9600; i < 9600 + 256; i++) {
            freePorts.push(i)
        }
    }
    return freePorts.pop()
}

const connectScrcpyServer = async (device, ws) => {
    const port = await getFreePort();
    const videoSocket = new Socket()
    // 发送文件到设备
    cp.exec(`${adb} -s ${device} push ${scrcpyServer} /data/local/tmp/scrcpy-server.jar`, (error, stdout, stderr) => {
        console.log(stdout)
        // adb反向代理
        cp.exec(`${adb} -s ${device} forward tcp:${port} localabstract:scrcpy`, (error2, stderr2, stdout2) => {
            console.log(`${adb} -s ${device} forward`)
            // 使用app_process运行scrcpy-server.jar
            // raw_video_stream=true 原生h264流
            cp.exec(`${adb} -s ${device} shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
                    app_process / com.genymobile.scrcpy.Server 1.24 \
                    raw_video_stream=true tunnel_forward=true control=false video_bit_rate=1000 max_fps=5`, (error3, stderr3, stdout3) => {
                console.log('scrcpy-server stop', port)
                freePorts.push(port)
            })
            // const device_info = {
            //     displaysCount: 0,
            //     name: '',
            //     width: 1080,
            //     height: 1920,
            // }
            setTimeout(() => {
                // socket连接
                videoSocket.on('connect', () => {
                    console.log('scrcpy连接成功', port)
                })
                videoSocket.on('data', (data) => {
                    ws.send(data, { binary: true })
                })
                videoSocket.on('error', (error) => {
                    console.log(error)
                })
                videoSocket.connect(port, '127.0.0.1')
            }, 2000)
        })
    })
    ws.on('close', () => {
        videoSocket.destroy()
    })
    ws.on('error', () => {
        videoSocket.destroy()
    })
}

const startServer = async () => {
    const websocketServer = new WebSocket.Server({ port: 9803 }, () => {
        console.log('WebSocket Sever.')
    })

    websocketServer.on('connection', (ws) => {
        console.log('连接成功')
        ws.onmessage = (msg => {
            console.log(msg.data)
            connectScrcpyServer(msg.data, ws)
        })
    })

}

export { startServer }