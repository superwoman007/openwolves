#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check prerequisites
check_prereqs() {
    command -v docker >/dev/null 2>&1 || error "Docker is not installed"
    docker compose version >/dev/null 2>&1 || error "Docker Compose is not available"
    info "Prerequisites OK"
}

# Ensure .env exists
check_env() {
    if [ ! -f .env ]; then
        warn ".env file not found, copying from .env.example"
        cp .env.example .env
        warn "Please edit .env with your production values before running again"
        exit 1
    fi
    info ".env file found"
}

# Create certs directory
ensure_dirs() {
    mkdir -p deploy/certs
    mkdir -p data
    info "Directories ready"
}

# Build
build() {
    info "Building Docker image..."
    docker compose build --no-cache
    info "Build complete"
}

# Start services
start() {
    info "Starting services..."
    docker compose up -d
    info "Services started"
    echo ""
    info "Health check: curl http://localhost/api/health"
    info "View logs: $0 --logs"
}

# Stop services
stop() {
    info "Stopping services..."
    docker compose down
    info "Services stopped"
}

# Restart
restart() {
    info "Restarting services..."
    docker compose restart
    info "Services restarted"
}

# Show logs
logs() {
    docker compose logs -f --tail=100
}

# Status
status() {
    docker compose ps
    echo ""
    echo "Health:"
    curl -s http://localhost/api/health 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  Service not reachable"
}

# Full deploy
deploy() {
    check_prereqs
    check_env
    ensure_dirs
    build
    start
    echo ""
    info "Deployment complete!"
}

# Parse arguments
case "${1:-}" in
    --build)
        check_prereqs
        build
        ;;
    --start)
        start
        ;;
    --stop)
        stop
        ;;
    --restart)
        restart
        ;;
    --logs)
        logs
        ;;
    --status)
        status
        ;;
    --help)
        echo "Usage: $0 [OPTION]"
        echo ""
        echo "Options:"
        echo "  (none)      Full deploy (build + start)"
        echo "  --build     Build Docker image only"
        echo "  --start     Start services"
        echo "  --stop      Stop services"
        echo "  --restart   Restart services"
        echo "  --logs      Follow service logs"
        echo "  --status    Show service status"
        echo "  --help      Show this help"
        ;;
    *)
        deploy
        ;;
esac
