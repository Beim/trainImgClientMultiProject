const path = require('path')

const schedule = require('node-schedule')

const controller = require('./controller')
const config = require('./config')


const job = schedule.scheduleJob(config.schedule, () => {
    controller.run()
})
controller.run()


