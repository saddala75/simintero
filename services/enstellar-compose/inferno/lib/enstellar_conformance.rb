# Inferno suite loader for Enstellar conformance runs.
# Loaded by inferno_core's suites boot (Dir.glob("lib/*.rb") in WORKDIR).
# Must require every test kit whose suites should appear in `inferno suites`.
require 'us_core_test_kit'
require 'davinci_pas_test_kit'
