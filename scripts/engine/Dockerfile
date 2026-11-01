FROM --platform=linux/amd64 amazonlinux:2023@sha256:b156298161e9ab6392cda59081d016866601f7213a28ec21270d3a75c72f2170

RUN dnf --releasever=2023.12.20261021 install -y \
      clang-15.0.7-3.amzn2023.0.4 llvm-15.0.7-3.amzn2023.0.1 \
      gcc gcc-c++ glibc-devel git tar gzip xz findutils \
    && dnf clean all

COPY install-tools.sh /install-tools.sh
RUN sh /install-tools.sh
ENV PATH="/opt/rust/bin:/opt/bindgen:${PATH}" \
    CARGO_HOME=/opt/cargo \
    CC_wasm32_unknown_unknown=/usr/bin/clang \
    AR_wasm32_unknown_unknown=/usr/bin/llvm-ar \
    SOURCE_DATE_EPOCH=1793333636 \
    TZ=UTC \
    LC_ALL=C

ARG SOURCE_REPOSITORY
ARG SOURCE_REVISION
ARG CARGO_LOCK_SHA256
RUN git init /source \
    && git -C /source fetch --depth=1 "$SOURCE_REPOSITORY" "$SOURCE_REVISION" \
    && git -C /source checkout --detach FETCH_HEAD \
    && test "$(git -C /source rev-parse HEAD)" = "$SOURCE_REVISION" \
    && echo "$CARGO_LOCK_SHA256  /source/Cargo.lock" | sha256sum -c - \
    && cd /source && cargo fetch --locked

COPY build.sh /build.sh
ENTRYPOINT ["sh", "/build.sh"]
