module.exports = (sequelize, DataTypes) => {
    const Attendance = sequelize.define("Attendance", {
        type: {
            type: DataTypes.ENUM('IN', 'OUT'),
            allowNull: false
        },
        timestamp: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'attendance'
    });

    Attendance.associate = (models) => {
        Attendance.belongsTo(models.User, {
            foreignKey: 'userId',
            onDelete: 'CASCADE'
        });
    };

    return Attendance;
};