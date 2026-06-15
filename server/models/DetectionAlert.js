module.exports = (sequelize, DataTypes) => {
    const DetectionAlert = sequelize.define("DetectionAlert", {
        zone_name: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        camera_location: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        status: {
            type: DataTypes.STRING(50),
            allowNull: false,
            defaultValue: 'Active'
        },
        object_class: {
            type: DataTypes.STRING(100),
            allowNull: true
        },
        duration_seconds: {
            type: DataTypes.INTEGER,
            allowNull: true
        },
        person_name: {
            type: DataTypes.STRING(255),
            allowNull: true
        }
    }, {
        tableName: 'detection_alerts',
        paranoid: true
    });
    return DetectionAlert;
};
