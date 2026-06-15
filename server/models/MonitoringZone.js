module.exports = (sequelize, DataTypes) => {
    const MonitoringZone = sequelize.define("MonitoringZone", {
        zone_name: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        location: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        time_threshold: {
            type: DataTypes.INTEGER,
            allowNull: false
        }
    }, {
        tableName: 'monitoring_zones',
        paranoid: true
    });
    return MonitoringZone;
};
