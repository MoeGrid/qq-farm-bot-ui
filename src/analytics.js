/**
 * 数据分析模块 - 作物效率分析
 */

const { getAllPlants } = require('./gameConfig');

function parseGrowTime(growPhases) {
    if (!growPhases) return 0;
    const phases = growPhases.split(';').filter(p => p.length > 0);
    let totalTime = 0;
    for (const phase of phases) {
        const match = phase.match(/:(\d+)$/);
        if (match) {
            totalTime += parseInt(match[1]);
        }
    }
    return totalTime;
}

function formatTime(seconds) {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}时${mins}分` : `${hours}时`;
}

function getPlantRankings(sortBy = 'exp') {
    const plants = getAllPlants();
    
    // 筛选普通作物
    const normalPlants = plants.filter(p => {
        const idStr = String(p.id);
        return idStr.startsWith('102') && p.seed_id && p.seed_id >= 20000 && p.seed_id < 30000;
    });

    const results = [];
    for (const plant of normalPlants) {
        const growTime = parseGrowTime(plant.grow_phases);
        if (growTime <= 0) continue;
        
        const harvestExp = parseInt(plant.exp) || 0;
        const expPerHour = (harvestExp / growTime) * 3600;
        // 普通化肥：理论加速 20%；但若缩短时间不足30秒，则按固定减少30秒计算
        const speedupSec = growTime * 0.2;
        const fertilizedGrowTime = speedupSec < 30 ? (growTime - 30) : (growTime * 0.8);
        const safeFertilizedTime = fertilizedGrowTime > 0 ? fertilizedGrowTime : 1;
        const normalFertilizerExpPerHour = (harvestExp / safeFertilizedTime) * 3600;
        
        // 估算金币收益 (售价 * 产量 - 种子成本)
        // 简单模型：假设产量为基准产量
        const output = parseInt(plant.output) || 0;
        const price = parseInt(plant.price) || 0; // 种子价格? 不，Plant.json里没有种子价格，种子价格在Shop.json里。
        // 这里暂时无法准确计算金币利润，除非引入 Shop 数据。
        // 但我们可以计算“产出价值效率”：(售价 * 产量) / 时间
        // Plant.json 里的 price 是果实单价吗？通常是。
        const income = output * price;
        const goldPerHour = (income / growTime) * 3600;

        const cfgLevel = Number(plant.land_level_need);
        const requiredLevel = (Number.isFinite(cfgLevel) && cfgLevel > 0) ? cfgLevel : null;
        results.push({
            id: plant.id,
            seedId: plant.seed_id,
            name: plant.name,
            level: requiredLevel,
            growTime,
            growTimeStr: formatTime(growTime),
            expPerHour: parseFloat(expPerHour.toFixed(2)),
            normalFertilizerExpPerHour: parseFloat(normalFertilizerExpPerHour.toFixed(2)),
            goldPerHour: parseFloat(goldPerHour.toFixed(2)), // 仅供参考
            income,
        });
    }

    if (sortBy === 'exp') {
        results.sort((a, b) => b.expPerHour - a.expPerHour);
    } else if (sortBy === 'fert') {
        results.sort((a, b) => b.normalFertilizerExpPerHour - a.normalFertilizerExpPerHour);
    } else if (sortBy === 'gold') {
        results.sort((a, b) => b.goldPerHour - a.goldPerHour);
    } else if (sortBy === 'level') {
        const lv = (v) => (v === null || v === undefined ? -1 : Number(v));
        results.sort((a, b) => lv(b.level) - lv(a.level));
    }

    return results;
}

module.exports = {
    getPlantRankings,
};
