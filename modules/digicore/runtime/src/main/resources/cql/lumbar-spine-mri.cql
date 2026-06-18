library LumbarSpineMri version '1.0.0'
parameter "conservative_therapy_6wk" Boolean
parameter "neuro_deficit_or_red_flag" Boolean
define "Conservative Therapy 6wk": "conservative_therapy_6wk"
define "Neuro Deficit Or Red Flag": "neuro_deficit_or_red_flag"
define "Meets All Criteria":
  "Conservative Therapy 6wk" and "Neuro Deficit Or Red Flag"
