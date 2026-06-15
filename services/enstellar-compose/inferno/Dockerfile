# Custom Inferno image: inferno_core 1.3.x (v2 Inferno framework architecture) + US Core 5.0.1 + Da Vinci PAS 2.0.1 test kits.
#
# NOTE: infernocommunity/inferno-core (Docker Hub latest, sha256:980d...) is the old
# inferno v1 architecture (Ruby 2.7, hanami) and is incompatible with inferno_core
# gem ~> 1.3 which requires Ruby ~> 3.3.6.  Base image is ruby:3.3.6, identical to
# the upstream inferno-framework/inferno-template reference project.
#
# Must be built with --platform linux/amd64 to match Inferno's published test-kit gems.
# On arm64 hosts this runs under emulation — slower but functional.
FROM --platform=linux/amd64 ruby:3.3.6@sha256:347edd0c70ee08d87de9f01b99de2f14a64cedb5d1bfb38457dfe8cd0bf113c5

ENV INSTALL_PATH=/opt/inferno
ENV BUNDLE_WITHOUT="development:test"
WORKDIR $INSTALL_PATH

COPY Gemfile ./
COPY Gemfile.lock ./
# lib/enstellar_conformance.rb is loaded by inferno_core's suites boot via
# Dir.glob("lib/*.rb") — it requires the test kits so suites are registered.
COPY lib/ ./lib/
RUN gem install bundler --no-document && \
    bundle install --jobs 4 && \
    bundle exec inferno suites

# Default: run the Inferno web server.
# nosemgrep: dockerfile.security.missing-user.missing-user  # false positive — local dev/CI conformance tool only; Inferno framework requires root to install native gem extensions
CMD ["bundle", "exec", "puma"]
