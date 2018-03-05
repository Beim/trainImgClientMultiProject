const config = {
    server: {
        hostname: '119.29.160.85',
        port: '20002',
    },
    solver: {
        defaultSolver: {
            net: "model/train_val.prototxt",
            test_iter: 1000,
            test_interval: 4000,
            test_initialization: "false",
            display: 100,
            average_loss: 40,
            base_lr: 0.01, // 学习率
            lr_policy: "step",
            stepsize: 320000,
            gamma: 0.96,
            max_iter: 100, // 最大循环
            momentum: 0.9,
            weight_decay: 0.0002,
            snapshot: 200,
            snapshot_prefix: "snapshot/bvlc_googlenet",
            solver_mode: 'GPU',
        },
        MAX_ITER: 1599,
        BASE_LR: 0.001,
    },
    train: {
        max_loss: 0.1,
    },
    schedule: '* * 0 * * *', // 每日执行任务的时间 每天0点
    
}

module.exports = config