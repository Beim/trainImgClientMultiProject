const fs = require('fs')
const path = require('path')
const querystring = require('querystring')
const child_process = require('child_process')

const util = require('./util')
const config = require('./config')

class Controller {

    constructor() {
        this.projects = []
    }

    async run() {
        // 1. 获取所有项目
        let ret = await util.requestServer('GET', '/projects')
        if (!ret) throw('get projects error')
        this.projects = ret.data.map((val, idx) => {
            return {
                id: val.id,
                name: val.name,
                projectPath: path.resolve(__dirname, 'projects', val.name),
            }
        })
        // 2. 检查项目目录
        for (let project of this.projects) {
            if (!fs.existsSync(project['projectPath'])) {
                await this.mkProjectFolder(project['projectPath'])
            }
        }
        // 3. 获取新增图片素材
        for (let project of this.projects) {
            ret = await util.requestServer('GET', `/images?projectId=${project.id}&&isTrained=false`)
            if (!ret) throw('get untrainedImgs error')
            const untrainedImgs = ret.data
            project.untrainedImgs = untrainedImgs
            // 标记有新增图片的项目
            project.hasUntrainedImgs = untrainedImgs.length > 0
            // 下拉未训练的图片
            for (let imgType of untrainedImgs) {
                await this.pullImgs(imgType, project)
            }
        }
        // 4. 对有新增图片的项目进行训练，训练成功后上传模型
        for (let project of this.projects) {
            if (!project.hasUntrainedImgs) continue
            let trainSuccess = await this.trainModelAsync(project)
            if (trainSuccess) {
                console.log('uploading model')
                // 上传模型
                await this.uploadCaffemodel(project)
                // 更新图片训练成功
                await this.updateImageTrainStatus(project.untrainedImgs)
                console.log('updateImageTrainStatus ok')
            }
            else {
                console.log('train failed, remove images')
                for (let imgType of project.untrainedImgs) {
                    const imgSavePath = path.resolve(project.projectPath, 'rawimages', String(imgType.labelNo))
                    child_process.execSync(`rm -r ${imgSavePath}`)
                }
            }
        }
        
    }

    // 上传训练好的caffemodel
    async uploadCaffemodel(project) {
        const caffemodelPath = path.resolve(project['projectPath'], 'caffemodel/model.caffemodel')
        if (!fs.existsSync(caffemodelPath)) throw(`${caffemodelPath} not found`)
        const formData = {
            caffemodel: fs.createReadStream(caffemodelPath)
        }
        await util.uploadFileServer(`/caffemodel/${project['id']}`, formData)
    }

    // 更新训练状态
    async updateImageTrainStatus(untrainedImgs) {
        for (let image of untrainedImgs) {
            await util.requestServer('PUT', `/image/record/${image['id']}?isTrained=true`)
        }
    }

    // 训练，loss小于一定值认为训练成功
    async trainModelAsync(project) {
        const caffe = new Caffe(project)
        const solver = new Solver(project)
        caffe.clearAll()
        caffe.genLabels()
        caffe.convImgs2Lmdb()
        // await caffe.caffeTrainAsync(solver)
        // await caffe.caffeTestAsync(solver)
        const caffemodelFilePath = path.resolve(caffe.paths.caffemodel, 'model.caffemodel')
        const caffemodelBackFilePath = path.resolve(caffe.paths.caffemodel, 'model.caffemodel.back')
        if (fs.existsSync(caffemodelFilePath)) {
            await util.exec(`cp ${caffemodelFilePath} ${caffemodelBackFilePath}`)
        }
        let loss = 1000
        while (loss > config.train.max_loss) {
            if (!solver.autoAdjustConfig()) break
            console.log('iter: ', solver.config.max_iter, ' lr: ', solver.config.base_lr)
            await caffe.caffeTrainAsync(solver)
            await util.exec(`cp ${path.resolve(caffe.paths.snapshot, `bvlc_googlenet_iter_${solver.config.max_iter}.caffemodel`)} ${path.resolve(caffe.paths.caffemodel, 'model.caffemodel')}`)
            loss = await caffe.caffeTestAsync(solver)
        }
        console.log('test: ', loss)
        const trainSuccess = loss <= config.train.max_loss
        if (!trainSuccess) {
            if (fs.existsSync(caffemodelBackFilePath)) {
                await util.exec(`cp ${caffemodelBackFilePath} ${caffemodelFilePath}`)
            }
        }
        return trainSuccess
    }

    // 下拉图片
    async pullImgs(imgType, project) {
        // 确认图片存放路径存在，不存在则新建
        const imgSavePath = path.resolve(project.projectPath, 'rawimages', String(imgType.labelNo))
        if (!fs.existsSync(imgSavePath)) {
            util.mkdirSync(imgSavePath)
        }
        let ret = await util.requestServer('GET', `/image/raw/list?projectId=${imgType.projectId}&&labelNo=${imgType.labelNo}`)
        if (!ret) throw(`get /image/raw/list?projectId=${imgType.projectId}&&labelNo=${imgType.labelNo} error`)
        const imgList = ret.data
        for (let imgname of imgList) {
            let queryStr = querystring.stringify({
                projectId: imgType.projectId,
                labelNo: imgType.labelNo,
                imgname: imgname,
            })
            ret = await util.requestServer('GET', `/image/raw?${queryStr}`)
            if (!ret || ret.ok !== 1) ret = await util.requestServer('GET', `/image/raw?${queryStr}`)
            if (!ret || ret.ok !== 1) throw(`get /image/raw?${queryStr} error`)
            let imgStr = ret.data
            util.saveFile(imgStr, path.resolve(imgSavePath, imgname))
        }        
    }

    // 新建项目目录，并将examples目录下文件复制过去
    async mkProjectFolder(projectPath) {
        const examplePath = path.resolve(__dirname, 'examples')
        util.mkdirSync(projectPath)
        return await util.exec(`cp -r ${examplePath}/* ${projectPath}`)
    }

}

class Caffe {

    constructor(project) {
        this.project = project
        this.paths = {
            images: path.resolve(project['projectPath'], 'rawimages'),
            trainTxt: path.resolve(project['projectPath'], 'lmdbimgs', 'train.txt'),
            testTxt: path.resolve(project['projectPath'], 'lmdbimgs', 'val.txt'),
            lmdb: path.resolve(project['projectPath'], 'lmdbimgs'),
            convertTool: path.resolve(__dirname, 'create_imgs_lmdb.sh'),
            snapshot: path.resolve(project['projectPath'], 'snapshot'),
            caffemodel: path.resolve(project['projectPath'], 'caffemodel'),
            caffeTool: '/opt/caffe/build/tools/caffe',
            trainValModel: path.resolve(this.project['projectPath'], 'model/train_val.prototxt'),
        }
    }

    // 生成标记
    genLabels() {
        const labelNames = fs.readdirSync(this.paths['images'])
        const trainTxtFd = fs.openSync(this.paths['trainTxt'], 'w')
        const testTxtFd = fs.openSync(this.paths['testTxt'], 'w')
        for (let label of labelNames) {
            const imgNames = fs.readdirSync(path.resolve(this.paths['images'], label))
            for (let j in imgNames) {
                const img = imgNames[j]
                const p = path.resolve(this.paths['images'], label, img) + ` ${label}\n`
                if (j % 5 !== 0) {
                    fs.writeSync(trainTxtFd, p)
                }
                else {
                    fs.writeSync(testTxtFd, p)
                }
            }
        }
        fs.closeSync(trainTxtFd)
        fs.closeSync(testTxtFd)
    }

    // 将图片转成lmdb
    convImgs2Lmdb() {
        const paths = this.paths
        child_process.execSync(`"${paths['convertTool']}" ${paths['trainTxt']} ${paths['testTxt']} ${paths['lmdb']} 2> /dev/null`)
    }

    clearAll() {
        const paths = this.paths
        if (fs.readdirSync(paths['lmdb']).length > 0)
            child_process.execSync(`rm -r ${paths['lmdb']}/*`)
        if (fs.readdirSync(paths['snapshot']).length > 0)
            child_process.execSync(`rm -r ${paths['snapshot']}/*`)
    }

    // 异步训练
    caffeTrainAsync(solver) {
        solver.sync()
        return new Promise((resolve, reject) => {
            const subProc = child_process.spawn(this.paths['caffeTool'], ['train', `--solver=${solver.solverPath}`], {cwd: this.project['projectPath']})
            subProc.stderr.on('data', data => {
                // console.log('stderr: ')
                // console.log(data.toString())
            })
            subProc.on('close', code => {
                resolve(code === 0 ? 0 : -1)
            })
            subProc.on('error', err => {
                reject(err)
            })
        })
    }

    // 异步测试
    caffeTestAsync(solver) {
        let loss = -1
        return new Promise((resolve, reject) => {
            const paths = this.paths
            const CAFFE_TOOL = paths['caffeTool']
            const MODEL_PATH = paths['trainValModel']
            const CAFFEMODEL_PATH = path.resolve(paths['caffemodel'], 'model.caffemodel')
            let sub_proc = null
            if (solver.config.solver_mode === 'GPU') {
                sub_proc = child_process.spawn(CAFFE_TOOL, ['test', '-model', MODEL_PATH, '-weights', CAFFEMODEL_PATH, '-gpu', '0', '-iterations', '50'], {'cwd': this.project['projectPath']})
            }
            else if (solver.config.solver_mode === 'CPU') {
                sub_proc = child_process.spawn(CAFFE_TOOL, ['test', '-model', MODEL_PATH, '-weights', CAFFEMODEL_PATH, '-iterations', '50'], {'cwd': this.project['projectPath']})
            }
            const reg = new RegExp('.*Loss: (.*)\n')
            sub_proc.stderr.on('data', (data) => {
                data = data.toString()
                // console.log(data)
                let result = data.match(reg)
                if (result) {
                    loss = parseFloat(result[1])
                }
            })
            sub_proc.on('close', (code) => {
                console.log('loss: ', loss)
                solver.losses.push(loss)
                resolve(code === 0 ? loss : -1)
                
            })
            sub_proc.on('error', (err) => {
                reject(err)
            })
        })
    }


}

/*
net: "model/train_val.prototxt"
test_iter: 1000
test_interval: 4000
test_initialization: false
display: 100
average_loss: 40
base_lr: 0.01
lr_policy: "step"
stepsize: 320000
gamma: 0.96
max_iter: 20
momentum: 0.9
weight_decay: 0.0002
snapshot: 200
snapshot_prefix: "snapshot/bvlc_googlenet"
solver_mode: CPU
*/

// 管理训练参数的类
class Solver {
    
    constructor(project) {
        this.project = project
        this.solverPath = path.resolve(project['projectPath'], 'model/solver.prototxt')
        this.recover()
        this.sync()
        this.MAX_ITER = config.solver.MAX_ITER
        this.BASE_LR = config.solver.BASE_LR
    }

    // 还原到默认配置
    recover() {
        this.losses = []
        this.config = JSON.parse(JSON.stringify(config.solver.defaultSolver))
    }

    // 同步配置到 model/solver.prototxt
    sync() {
        let solver_prototxt = ''
        for (let key in this.config) {
            let value = this.config[key]
            if (['net', 'lr_policy', 'snapshot_prefix'].includes(key)) {
                solver_prototxt += `${key}: "${value}"\n`
            }
            else {
                solver_prototxt += `${key}: ${value}\n`
            }
        }
        fs.writeFileSync(this.solverPath, solver_prototxt)
    }

    // 调整参数的策略
    autoAdjustConfig() {
        let losses_len = this.losses.length
        if (losses_len > 2 && this.losses[losses_len - 1] > 10 * this.losses[losses_len - 2]) {
            this.reduceLr()
            return true
        } 
        else if (this.config.max_iter < this.MAX_ITER) {
            this.increaseIter()
            return true
        }
        else if (this.config.base_lr > this.BASE_LR) {
            this.reduceLr()
            return true
        }
        else {
            return false
        }
    }

    reduceLr() {
        this.config.base_lr /= 2
        this.sync()
    }

    increaseIter() {
        this.config.max_iter *= 2
        this.sync()
    }

    // 更新参数，并同步到文件
    update(new_config={}) {
        Object.assign(this.config, new_config)
        this.sync()
    }
}

module.exports = new Controller()