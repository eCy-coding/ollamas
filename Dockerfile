# Use a minimal base image
FROM golang:1.22 as builder

# Set the working directory
WORKDIR /app

# Copy the Go module files
COPY go.mod go.sum ./

# Download and vendor dependencies
RUN go mod download

# Copy the source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 go build -o ollamas -ldflags "-X main.version=$(git describe --tags --always --dirty) -X main.build=$(date +%Y%m%d%H%M%S)" ./cmd

# Use a minimal base image for the final stage
FROM gcr.io/distroless/static-debian12

# Copy the binary from the builder stage
COPY --from=builder /app/ollamas /app/ollamas

# Set the entry point
ENTRYPOINT ["/app/ollamas"]