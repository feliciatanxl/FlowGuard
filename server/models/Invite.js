module.exports = (sequelize, DataTypes) => {
    const Invite = sequelize.define("Invite", {
        code: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        role: {
            type: DataTypes.ENUM('Tenant'),
            defaultValue: 'Tenant'
        },
        isUsed: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        expiresAt: {
            type: DataTypes.DATE,
            allowNull: false
        }
    }, {
        tableName: 'invites'
    });

    return Invite;
};