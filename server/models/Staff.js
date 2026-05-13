module.exports = (sequelize, DataTypes) => {
    const Staff = sequelize.define("Staff", {
        name: {
            type: DataTypes.STRING(100),
            allowNull: false
        },
        role: {
            type: DataTypes.STRING(50),
            allowNull: true
        },
        face_embedding: {
            type: DataTypes.TEXT,
            allowNull: false
        }
    }, {
        tableName: 'staff_members',
        paranoid: true
    });
    return Staff;
}