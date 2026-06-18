library UpperEndoscopy version '1.0.0'
parameter "alarm_symptom_documented" Boolean
parameter "failed_ppi_trial" Boolean
define "Alarm Symptom Documented": "alarm_symptom_documented"
define "Failed PPI Trial": "failed_ppi_trial"
define "Meets All Criteria":
  "Alarm Symptom Documented" and "Failed PPI Trial"
