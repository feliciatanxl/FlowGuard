module.exports = (sequelize, DataTypes) => {
  const SecurityLog = sequelize.define('SecurityLog', {
    id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    time: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    desc: { type: DataTypes.TEXT, allowNull: false },
    severity: { type: DataTypes.STRING, allowNull: false, defaultValue: 'safe' },
    icon: { type: DataTypes.STRING, allowNull: false },
    
    // 🎯 NEW: Dedicated column to link to the Personnel Page
    personnelName: { 
      type: DataTypes.STRING, 
      allowNull: true, // True because intruders won't have a registered name
      description: 'The exact name of the verified staff member'
    }
  }, {
    tableName: 'security_logs',
    timestamps: true, 
  });

  return SecurityLog;
};