module.exports = (sequelize, DataTypes) => {
    const IncidentLog = sequelize.define("IncidentLog", {
        camera_location: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        status: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        person_name: {
            type: DataTypes.STRING(255),
            allowNull: true
        },
        confidence_score: {
            type: DataTypes.DECIMAL(5, 4),
            allowNull: true
        },
        severity: {
            type: DataTypes.STRING(20),
            allowNull: true,
            defaultValue: 'Medium'
        },
        source: {
            type: DataTypes.STRING(50),
            allowNull: true,
            defaultValue: 'Facial Recognition'
        },
        resolutionStatus: {
            type: DataTypes.STRING(50),
            allowNull: false,
            defaultValue: 'Active'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: ''
        }
    }, {
        tableName: 'incident_logs',
        paranoid: true
    });

    // Reverse side of DetectionAlert.belongsTo(IncidentLog, as: 'incident').
    // An IncidentLog created alongside an edge/AI DetectionAlert can be joined back to
    // it so the Incident API can surface the rich detection fields (object_class such
    // as `rat`, confidence, device_id, zone, snapshot_url) that live ONLY on the alert.
    // hasOne (not hasMany) because the edge/AI routes create exactly one alert per
    // incident. Nullable FK — manual/facial-recognition incidents simply have no linked
    // alert and this association resolves to null, so those incidents keep rendering.
    IncidentLog.associate = (models) => {
        if (models.DetectionAlert) {
            IncidentLog.hasOne(models.DetectionAlert, {
                foreignKey: 'incident_log_id',
                as: 'detectionAlert'
            });
        }
    };

    return IncidentLog;
}