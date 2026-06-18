library KneeArthroscopy version '1.0.0'
parameter "diagnosis_documented" Boolean
parameter "conservative_therapy_tried" Boolean
parameter "imaging_documented" Boolean
define "Diagnosis Documented": "diagnosis_documented"
define "Conservative Therapy Tried": "conservative_therapy_tried"
define "Imaging Documented": "imaging_documented"
define "Meets All Criteria":
  "Diagnosis Documented" and "Conservative Therapy Tried" and "Imaging Documented"
