library CtAbdomenPelvis version '1.0.0'
parameter "acute_indication_documented" Boolean
parameter "prior_imaging_insufficient" Boolean
define "Acute Indication Documented": "acute_indication_documented"
define "Prior Imaging Insufficient": "prior_imaging_insufficient"
define "Meets All Criteria":
  "Acute Indication Documented" and "Prior Imaging Insufficient"
