module.exports = (sequelize, DataTypes) => {
    const Booking = sequelize.define("Booking", {
        booking_ref: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true
        },
        transport_company: {
            type: DataTypes.STRING(255),
            allowNull: false
        },
        license_plate: {
            type: DataTypes.STRING(20),
            allowNull: false
        },
        driver_phone: {
            type: DataTypes.STRING(20),
            allowNull: false
        },
        loading_bay: {
            type: DataTypes.STRING(50),
            allowNull: false
        },
        status: {
            type: DataTypes.STRING(50),
            defaultValue: 'Pending'
        }
    }, {
        tableName: 'bookings',
        paranoid: true
    });

    return Booking;
};